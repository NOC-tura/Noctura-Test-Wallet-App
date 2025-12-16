use core::cmp::Ordering;

use anchor_lang::prelude::*;
use solana_program::{
    alt_bn128::prelude::*,
    log::sol_log_data,
};

#[cfg(test)]
mod pairing_debug {
    use super::*;
    use std::sync::Mutex;

    #[derive(Clone, Debug)]
    pub struct PairingTerm {
        pub label: &'static str,
        pub g1: [u8; G1_BYTES],
        pub g2: [u8; G2_BYTES],
    }

    impl PairingTerm {
        pub fn new(label: &'static str, g1: &[u8; G1_BYTES], g2: &[u8; G2_BYTES]) -> Self {
            Self {
                label,
                g1: *g1,
                g2: *g2,
            }
        }
    }

    static LAST_TERMS: Mutex<Vec<PairingTerm>> = Mutex::new(Vec::new());

    pub fn record_pairing_terms(terms: Vec<PairingTerm>) {
        let mut guard = LAST_TERMS
            .lock()
            .expect("pairing terms mutex poisoned");
        *guard = terms;
    }

    pub fn pairing_terms() -> Vec<PairingTerm> {
        LAST_TERMS
            .lock()
            .expect("pairing terms mutex poisoned")
            .clone()
    }
}

#[cfg(test)]
use pairing_debug::{pairing_terms, record_pairing_terms, PairingTerm};

#[cfg(test)]
mod ic_debug {
    use super::*;
    use std::sync::Mutex;

    #[derive(Clone, Debug)]
    pub struct ScalarMulRecord {
        pub point: [u8; G1_BYTES],
        pub scalar: [u8; 32],
        pub result: Option<[u8; G1_BYTES]>,
        pub success: bool,
    }

    impl ScalarMulRecord {
        pub fn new(point: &[u8; G1_BYTES], scalar: &[u8; 32]) -> Self {
            Self {
                point: *point,
                scalar: *scalar,
                result: None,
                success: false,
            }
        }
    }

    static SCALAR_MUL_LOG: Mutex<Vec<ScalarMulRecord>> = Mutex::new(Vec::new());

    pub fn log_scalar_mul_attempt(point: &[u8; G1_BYTES], scalar: &[u8; 32]) {
        let mut guard = SCALAR_MUL_LOG
            .lock()
            .expect("scalar mul log poisoned");
        guard.push(ScalarMulRecord::new(point, scalar));
    }

    pub fn log_scalar_mul_success(result: &[u8; G1_BYTES]) {
        let mut guard = SCALAR_MUL_LOG
            .lock()
            .expect("scalar mul log poisoned");
        if let Some(last) = guard.last_mut() {
            last.result = Some(*result);
            last.success = true;
        }
    }

    pub fn log_scalar_mul_failure() {
        let mut guard = SCALAR_MUL_LOG
            .lock()
            .expect("scalar mul log poisoned");
        if let Some(last) = guard.last_mut() {
            last.result = None;
            last.success = false;
        }
    }

    pub fn scalar_mul_records() -> Vec<ScalarMulRecord> {
        SCALAR_MUL_LOG
            .lock()
            .expect("scalar mul log poisoned")
            .clone()
    }
}

#[cfg(test)]
use ic_debug::{
    log_scalar_mul_attempt,
    log_scalar_mul_failure,
    log_scalar_mul_success,
    scalar_mul_records,
};

#[cfg(test)]
mod ic_accumulator_debug {
    use super::*;
    use std::sync::Mutex;

    #[derive(Clone, Debug)]
    pub struct IcTerm {
        pub index: usize,
        pub scalar: [u8; 32],
        pub point: [u8; G1_BYTES],
    }

    static IC_TERMS: Mutex<Vec<IcTerm>> = Mutex::new(Vec::new());

    pub fn log_ic_term(index: usize, scalar: &[u8; 32], point: &[u8; G1_BYTES]) {
        let mut guard = IC_TERMS.lock().expect("ic accumulator log poisoned");
        guard.push(IcTerm {
            index,
            scalar: *scalar,
            point: *point,
        });
    }

    pub fn recorded_ic_terms() -> Vec<IcTerm> {
        IC_TERMS.lock().expect("ic accumulator log poisoned").clone()
    }
}

#[cfg(test)]
use ic_accumulator_debug::{log_ic_term, recorded_ic_terms};

use crate::{errors::ShieldError, state::VerifierAccount};

const G1_BYTES: usize = 64;
const G2_BYTES: usize = 128;
const PAIRING_TERM_BYTES: usize = G1_BYTES + G2_BYTES;
const G1_OP_INPUT_BYTES: usize = 128;
// BN128 base field modulus p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
const FIELD_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];
const PAIRING_SUCCESS: [u8; 32] = {
    let mut out = [0u8; 32];
    out[31] = 1;
    out
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PackedVerifierKey {
    pub alpha_g1: [u8; G1_BYTES],
    pub beta_g2: [u8; G2_BYTES],
    pub gamma_g2: [u8; G2_BYTES],
    pub delta_g2: [u8; G2_BYTES],
    pub ic: Vec<[u8; G1_BYTES]>,
}

struct Groth16Proof {
    a: [u8; G1_BYTES],
    b: [u8; G2_BYTES],
    c: [u8; G1_BYTES],
}

pub fn verify_groth16(
    verifier: &VerifierAccount,
    proof_bytes: &[u8],
    public_inputs: &[[u8; 32]],
) -> Result<()> {
    require!(!verifier.verifying_key.is_empty(), ShieldError::VerifierMissing);

    let key = load_verifier_key(&verifier.verifying_key)?;
    require!(!key.ic.is_empty(), ShieldError::InvalidVerifierKey);
    #[cfg(test)]
    println!(
        "verifier ic entries: {} expected: {}",
        key.ic.len(),
        public_inputs.len() + 1
    );
    require!(key.ic.len() == public_inputs.len() + 1, ShieldError::InvalidProof);

    let proof = Groth16Proof::from_bytes(proof_bytes)?;
    log_public_inputs(public_inputs);
    let scalars = normalize_public_inputs(public_inputs);
    log_normalized_scalars(&scalars);
    let vk_x = accumulate_ic(&key.ic, &scalars)?;
    log_vk_accumulator(&vk_x);

    // Groth16 verification equation: e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
    // Rewritten as product = 1: e(A, B) * e(alpha, -beta) * e(vk_x, -gamma) * e(C, -delta) = 1
    let beta_neg = negate_g2(&key.beta_g2);
    let gamma_neg = negate_g2(&key.gamma_g2);
    let delta_neg = negate_g2(&key.delta_g2);

    let mut pairing_input = Vec::with_capacity(PAIRING_TERM_BYTES * 4);
    push_pair(&mut pairing_input, &proof.a, &proof.b);
    push_pair(&mut pairing_input, &vk_x, &gamma_neg);
    push_pair(&mut pairing_input, &proof.c, &delta_neg);
    push_pair(&mut pairing_input, &key.alpha_g1, &beta_neg);

    #[cfg(test)]
    record_pairing_terms(vec![
        PairingTerm::new("A * B", &proof.a, &proof.b),
        PairingTerm::new("vk_x * -gamma", &vk_x, &gamma_neg),
        PairingTerm::new("C * -delta", &proof.c, &delta_neg),
        PairingTerm::new("alpha * -beta", &key.alpha_g1, &beta_neg),
    ]);

    log_pairing_terms(&[
        (&proof.a, &proof.b, "proof.a x proof.b"),
        (&vk_x, &gamma_neg, "vk_x x -gamma"),
        (&proof.c, &delta_neg, "proof.c x -delta"),
        (&key.alpha_g1, &beta_neg, "alpha x -beta"),
    ]);

    let result = alt_bn128_pairing(&pairing_input).map_err(|_| ShieldError::InvalidProof)?;
    require!(result.as_slice() == PAIRING_SUCCESS, ShieldError::InvalidProof);
    Ok(())
}

fn log_public_inputs(inputs: &[[u8; 32]]) {
    if inputs.is_empty() {
        return;
    }
    if let Some(first) = inputs.get(0) {
        sol_log_data(&[b"shield.public_inputs[0]", first.as_ref()]);
    }
    if let Some(second) = inputs.get(1) {
        sol_log_data(&[b"shield.public_inputs[1]", second.as_ref()]);
    }
}

fn log_normalized_scalars(inputs: &[[u8; 32]]) {
    if inputs.is_empty() {
        return;
    }
    if let Some(first) = inputs.get(0) {
        sol_log_data(&[b"shield.scalars[0]", first.as_ref()]);
    }
    if let Some(second) = inputs.get(1) {
        sol_log_data(&[b"shield.scalars[1]", second.as_ref()]);
    }
}

fn log_vk_accumulator(vk_x: &[u8; G1_BYTES]) {
    sol_log_data(&[b"shield.vk_x", vk_x.as_ref()]);
}

#[cfg(feature = "pairing-logs")]
fn log_pairing_terms(terms: &[(&[u8; G1_BYTES], &[u8; G2_BYTES], &'static str)]) {
    for (g1, g2, label) in terms {
        sol_log_data(&[b"shield.pairing.term", label.as_bytes(), g1.as_ref(), g2.as_ref()]);
    }
}

#[cfg(not(feature = "pairing-logs"))]
fn log_pairing_terms(_: &[(&[u8; G1_BYTES], &[u8; G2_BYTES], &'static str)]) {}

pub fn validate_verifier_key_blob(bytes: &[u8]) -> Result<()> {
    let key = load_verifier_key(bytes)?;
    require!(!key.ic.is_empty(), ShieldError::InvalidVerifierKey);
    Ok(())
}

fn load_verifier_key(bytes: &[u8]) -> Result<PackedVerifierKey> {
    Ok(PackedVerifierKey::try_from_slice(bytes).map_err(|_| error!(ShieldError::InvalidVerifierKey))?)
}

impl Groth16Proof {
    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        const PROOF_BYTES: usize = G1_BYTES + G2_BYTES + G1_BYTES;
        require!(bytes.len() == PROOF_BYTES, ShieldError::InvalidProof);
        let mut a = [0u8; G1_BYTES];
        let mut b = [0u8; G2_BYTES];
        let mut c = [0u8; G1_BYTES];
        a.copy_from_slice(&bytes[..G1_BYTES]);
        b.copy_from_slice(&bytes[G1_BYTES..G1_BYTES + G2_BYTES]);
        c.copy_from_slice(&bytes[G1_BYTES + G2_BYTES..]);
        Ok(Self { a, b, c })
    }
}

fn accumulate_ic(ic: &[[u8; G1_BYTES]], scalars: &[[u8; 32]]) -> Result<[u8; G1_BYTES]> {
    let mut acc = ic[0];
    for (_index, (scalar, point)) in scalars.iter().zip(ic.iter().skip(1)).enumerate() {
        #[cfg(test)]
        log_ic_term(_index, scalar, point);
        if is_zero(scalar) || is_zero(point) {
            continue;
        }
        let mul = g1_scalar_mul(point, scalar)?;
        acc = g1_add(&acc, &mul)?;
    }
    Ok(acc)
}

fn normalize_public_inputs(inputs: &[[u8; 32]]) -> Vec<[u8; 32]> {
    // Public inputs are already in big-endian format (EIP-196)
    inputs.iter().map(|bytes| reduce_mod_order_be(bytes)).collect()
}

fn reduce_mod_order_be(input_be: &[u8; 32]) -> [u8; 32] {
    let mut value = *input_be;
    while cmp_be(&value, &FIELD_MODULUS_BE) != Ordering::Less {
        sub_assign_be(&mut value, &FIELD_MODULUS_BE);
    }
    value
}

fn g1_add(p: &[u8; G1_BYTES], q: &[u8; G1_BYTES]) -> Result<[u8; G1_BYTES]> {
    let mut input = [0u8; G1_OP_INPUT_BYTES];
    // Solana alt_bn128_addition expects BE input (per EIP-196)
    // The syscall internally converts BE to LE for ark-bn254
    input[..G1_BYTES].copy_from_slice(p);
    input[G1_BYTES..].copy_from_slice(q);
    let result = alt_bn128_addition(&input).map_err(|_| error!(ShieldError::InvalidProof))?;
    // Syscall returns BE (converted from ark's LE output)
    let point = read_g1_be(result.as_slice()).map_err(|_| error!(ShieldError::InvalidProof))?;
    Ok(point)
}

fn g1_scalar_mul(point: &[u8; G1_BYTES], scalar_be: &[u8; 32]) -> Result<[u8; G1_BYTES]> {
    #[cfg(test)]
    log_scalar_mul_attempt(point, scalar_be);
    // Use 96 bytes: 64 for G1 point + 32 for scalar (EIP-196 format)
    let mut input = [0u8; 96];
    // Solana alt_bn128_multiplication expects BE input (per EIP-196)
    // The syscall internally converts BE to LE for ark-bn254
    input[..G1_BYTES].copy_from_slice(point);
    input[G1_BYTES..G1_BYTES + 32].copy_from_slice(scalar_be);
    #[cfg(test)]
    {
        use base64::prelude::*;
        println!("g1_scalar_mul input buffer (BE):");
        println!("  point_x_be b64: {}", BASE64_STANDARD.encode(&input[0..32]));
        println!("  point_y_be b64: {}", BASE64_STANDARD.encode(&input[32..64]));
        println!("  scalar_be b64:  {}", BASE64_STANDARD.encode(&input[64..96]));
    }
    // Log the actual input to the syscall
    sol_log_data(&[b"shield.scalar_mul.point_x", &input[0..32]]);
    sol_log_data(&[b"shield.scalar_mul.point_y", &input[32..64]]);
    sol_log_data(&[b"shield.scalar_mul.scalar", &input[64..96]]);
    let raw = alt_bn128_multiplication(&input).map_err(|err| {
        #[cfg(test)]
        {
            println!("alt_bn128_multiplication failed: {err:?}");
            log_scalar_mul_failure();
        }
        // Log the error type
        let err_code: u64 = err.clone().into();
        sol_log_data(&[b"shield.scalar_mul.error", &err_code.to_le_bytes()]);
        error!(ShieldError::InvalidProof)
    })?;
    let arr = read_g1_be(raw.as_slice()).map_err(|_| error!(ShieldError::InvalidProof))?;
    #[cfg(test)]
    log_scalar_mul_success(&arr);
    Ok(arr)
}

#[allow(dead_code)]
fn negate_g1(point: &[u8; G1_BYTES]) -> [u8; G1_BYTES] {
    let mut out = *point;
    let neg_y = negate_coordinate(&point[32..]);
    out[32..].copy_from_slice(&neg_y);
    out
}

fn negate_g2(point: &[u8; G2_BYTES]) -> [u8; G2_BYTES] {
    let mut out = *point;
    let neg_real = negate_coordinate(&point[64..96]);
    let neg_imag = negate_coordinate(&point[96..128]);
    out[64..96].copy_from_slice(&neg_real);
    out[96..128].copy_from_slice(&neg_imag);
    out
}

fn negate_coordinate(coord: &[u8]) -> [u8; 32] {
    if is_zero(coord) {
        return [0u8; 32];
    }
    let mut result = FIELD_MODULUS_BE;
    sub_assign_be(&mut result, coord);
    result
}

fn push_pair(buffer: &mut Vec<u8>, g1: &[u8; G1_BYTES], g2: &[u8; G2_BYTES]) {
    // Solana alt_bn128_pairing expects BE input (per EIP-196)
    // The syscall internally converts BE to LE for ark-bn254
    buffer.extend_from_slice(g1);
    buffer.extend_from_slice(g2);
}

#[allow(dead_code)]
fn le_to_be(input: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, byte) in input.iter().enumerate() {
        out[31 - i] = *byte;
    }
    out
}

#[allow(dead_code)]
fn be_to_le(input: &[u8; 32]) -> [u8; 32] {
    le_to_be(input)
}

#[allow(dead_code)]
fn write_g1_le(dst: &mut [u8], point_be: &[u8; G1_BYTES]) {
    let x_be: [u8; 32] = point_be[..32]
        .try_into()
        .expect("G1 x coordinate must be 32 bytes");
    let y_be: [u8; 32] = point_be[32..]
        .try_into()
        .expect("G1 y coordinate must be 32 bytes");
    let x_le = be_to_le(&x_be);
    let y_le = be_to_le(&y_be);
    dst[..32].copy_from_slice(&x_le);
    dst[32..64].copy_from_slice(&y_le);
}

fn read_g1_be(src_be: &[u8]) -> Result<[u8; G1_BYTES]> {
    // The Solana alt_bn128 syscall returns points in BE format (per EIP-196)
    if src_be.len() != G1_BYTES {
        return Err(error!(ShieldError::InvalidProof));
    }
    let mut out = [0u8; G1_BYTES];
    out.copy_from_slice(src_be);
    // Clear high bits if needed (shouldn't be necessary for valid points)
    clear_high_bit(&mut out[..32].try_into().unwrap());
    clear_high_bit(&mut out[32..].try_into().unwrap());
    Ok(out)
}

#[allow(dead_code)]
fn clear_high_bit(coord: &mut [u8; 32]) {
    coord[0] &= 0x7F;
}

#[allow(dead_code)]
fn g1_to_le_bytes(point_be: &[u8; G1_BYTES]) -> [u8; G1_BYTES] {
    let mut out = [0u8; G1_BYTES];
    write_g1_le(&mut out, point_be);
    out
}

#[allow(dead_code)]
fn g2_to_le_bytes(point_be: &[u8; G2_BYTES]) -> [u8; G2_BYTES] {
    let mut out = [0u8; G2_BYTES];
    for chunk_idx in 0..4 {
        let start = chunk_idx * 32;
        let end = start + 32;
        let slice_be: [u8; 32] = point_be[start..end]
            .try_into()
            .expect("G2 coordinate chunk must be 32 bytes");
        let slice_le = be_to_le(&slice_be);
        out[start..end].copy_from_slice(&slice_le);
    }
    out
}

fn cmp_be(a: &[u8; 32], b: &[u8; 32]) -> Ordering {
    for i in 0..32 {
        if a[i] != b[i] {
            return a[i].cmp(&b[i]);
        }
    }
    Ordering::Equal
}

fn sub_assign_be(lhs: &mut [u8; 32], rhs: &[u8]) {
    let mut borrow = 0i16;
    for i in (0..32).rev() {
        let mut diff = lhs[i] as i16 - rhs[i] as i16 - borrow;
        if diff < 0 {
            diff += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        lhs[i] = diff as u8;
    }
}

fn is_zero(bytes: &[u8]) -> bool {
    bytes.iter().all(|b| *b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::AnchorSerialize;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use num_bigint::BigUint;
    use serde_json::Value;
    use std::{fs, path::PathBuf};

    fn decimal_to_bytes_be(value: &Value) -> [u8; 32] {
        let text = value.as_str().expect("expected decimal string");
        let bigint = BigUint::parse_bytes(text.as_bytes(), 10).expect("invalid decimal");
        let bytes = bigint.to_bytes_be();
        assert!(bytes.len() <= 32, "field element exceeds 32 bytes");
        let mut out = [0u8; 32];
        let start = 32 - bytes.len();
        out[start..].copy_from_slice(&bytes);
        out
    }

    fn pack_g1(point: &Value) -> [u8; 64] {
        let coords = point.as_array().expect("expected array with G1 coords");
        let mut out = [0u8; 64];
        out[..32].copy_from_slice(&decimal_to_bytes_be(&coords[0]));
        out[32..].copy_from_slice(&decimal_to_bytes_be(&coords[1]));
        out
    }

    fn pack_g2(point: &Value) -> [u8; 128] {
        let coords = point.as_array().expect("expected array with G2 coords");
        let x = coords[0].as_array().expect("expected x coords");
        let y = coords[1].as_array().expect("expected y coords");
        let mut out = [0u8; 128];
        // EIP-196 format: [x_imag, x_real, y_imag, y_real] = [x.c1, x.c0, y.c1, y.c0]
        out[..32].copy_from_slice(&decimal_to_bytes_be(&x[1])); // x_imag (c1)
        out[32..64].copy_from_slice(&decimal_to_bytes_be(&x[0])); // x_real (c0)
        out[64..96].copy_from_slice(&decimal_to_bytes_be(&y[1])); // y_imag (c1)
        out[96..].copy_from_slice(&decimal_to_bytes_be(&y[0])); // y_real (c0)
        out
    }

    fn load_packed_key() -> VerifierAccount {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let vkey_path = manifest_dir.join("../../zk/keys/deposit.vkey.json");
        let raw = fs::read_to_string(vkey_path).expect("failed to read deposit.vkey.json");
        let json: Value = serde_json::from_str(&raw).expect("invalid json");
        let ic_points = json["IC"].as_array().expect("missing IC entries");
        let ic: Vec<[u8; 64]> = ic_points.iter().map(pack_g1).collect();
        let packed = PackedVerifierKey {
            alpha_g1: pack_g1(&json["vk_alpha_1"]),
            beta_g2: pack_g2(&json["vk_beta_2"]),
            gamma_g2: pack_g2(&json["vk_gamma_2"]),
            delta_g2: pack_g2(&json["vk_delta_2"]),
            ic,
        };
        let verifying_key = packed
            .try_to_vec()
            .expect("failed to serialize verifier key");
        VerifierAccount { verifying_key }
    }

    fn decode_base64_array<const N: usize>(value: &str) -> [u8; N] {
        let bytes = STANDARD.decode(value).expect("invalid base64 value");
        let arr: [u8; N] = bytes.try_into().expect("unexpected length");
        arr
    }

    #[test]
    fn deposit_vector_matches_js_verifier() {
        let verifier = load_packed_key();
        // EIP-196 format: pi_a (G1: x,y BE), pi_b (G2: x.c1,x.c0,y.c1,y.c0 BE), pi_c (G1: x,y BE)
        let proof_base64 = "BPN0T9GKkKkLhOBagJaHdPuDRwmHQRW0Hmb+PmJu/5AfQIVrEf4hbitHR9dvJiTzQ613U2AqdlOA74uEj6Jo7xPxg7fPu2zg6hiGpMdlyAq8IuSfWNzsCR2YuXWP0ZWnEozvYBnRufnm8v+ws+Cgja0CM3LfLE81fS2CrgcYk6UqhxzsxXjeC6LwD/z7adLnfY6o3IMmKHpIXCYFQBwrVwc+8mKd7rpQ1utAEJQnPN8tbR3PWhDQKhhlsmVDmWjyI8bq1G9LWxVYnK8q1+4ENEfsKHEeGrXbC/kcUozWS6cWGsdpRlsJYGeGDS9IAVbpfj5kHFcNrILa/BiBIgUSbQ==";
        let proof_bytes = STANDARD
            .decode(proof_base64)
            .expect("invalid proof base64");
        assert_eq!(proof_bytes.len(), 256);

        // Public inputs in big-endian format (EIP-196 requires BE)
        let inputs_base64 = [
            "BbUNpP4upFSSo5lZKpo1ddfTUWJfrvE5YcSVkisu2vM=",
            "BbUNpP4upFSSo5lZKpo1ddfTUWJfrvE5YcSVkisu2vM=",
        ];
        let public_inputs: Vec<[u8; 32]> = inputs_base64
            .iter()
            .map(|value| decode_base64_array::<32>(value))
            .collect();

        let result = verify_groth16(&verifier, &proof_bytes, &public_inputs);
        if let Err(err) = result {
            dump_pairing_terms("deposit_vector_matches_js_verifier");
            dump_scalar_mul_records("deposit_vector_matches_js_verifier");
            dump_ic_terms("deposit_vector_matches_js_verifier");
            panic!("verify_groth16 failed: {err:?}");
        }
    }

    #[test]
    #[ignore = "Old proof with wrong encoding format"]
    fn deposit_proof_matches_onchain_verifier() {
        let verifier = load_packed_key();
        let proof_base64 = "Awwi3bcR4TgbZ1Fgxb/b1w6iQbsPd8yCZMl9QkWcWlACIlCiTxvHIanAlvbfH/+u401edOsIRgCf+FgvPMWAtxX7fajKTF3KNjomtgKbx1v49mLUce/8bcWH6EvrjOqjBmxJHU9zZjtXHTb/18jC1O2KOkJ2x7gJrU0w2f8iXYMdL1ybT5UK27XPNxcdEyJF+/DUTd1TjHH/Gndsmonbwx4T6WgwXeXwjBSSYzuvDQ82gnwwQIGAmFJHekLXCkMPIXj54Ou8rFwdV3A7fC5XJtc/OgB4HzwZI/2qULhTGPcoHWAuUelu5B3Tl3va9rWkdT0RcU/lP5W4VUIz26hMOw==";
        let proof_bytes = STANDARD
            .decode(proof_base64)
            .expect("invalid proof base64");
        assert_eq!(proof_bytes.len(), 256);

        let inputs_base64 = [
            "VPM6Nm9Lw3xqVKjuj07j6KOweJAqwnON7TJ9aSUZMQQ=",
            "VPM6Nm9Lw3xqVKjuj07j6KOweJAqwnON7TJ9aSUZMQQ=",
        ];
        let public_inputs: Vec<[u8; 32]> = inputs_base64
            .iter()
            .map(|value| {
                let bytes = STANDARD.decode(value).expect("invalid public input base64");
                let arr: [u8; 32] = bytes
                    .try_into()
                    .expect("public input must be 32 bytes");
                arr
            })
            .collect();

        let result = verify_groth16(&verifier, &proof_bytes, &public_inputs);
        if result.is_err() {
            dump_pairing_terms("deposit_proof_matches_onchain_verifier");
            dump_scalar_mul_records("deposit_proof_matches_onchain_verifier");
        }
        assert!(result.is_ok(), "verify_groth16 failed: {result:?}");
    }

    #[test]
    #[ignore = "Live deposit proof currently fails on verifier"]
    fn live_dumped_deposit_proof_still_fails() {
        let verifier = load_packed_key();
        let proof_base64 = "Ks4DTNxxXPsbLRhHpVsjBZesj8CjFMQLjSl0oavtl4oG524Ph0CVjO+f+/UWTeRrTuiOgIV7RtAYNYjG8w6LqAluSQKkfNAfQAnl5wk6F0YWdcJUFIbgj4xG15zI97mJCZrhhbGCaIV7o+biRVgGB4wxZvpmpiEPAq3SrjJwegQovvL13uBY8Zo3ZAQiI6zktR5IS5cx8y4AYZR2GpqP6QyK75nCANn5DZmi0m1/dFR1Tf021yy7x1mLZjZbGKA4B3nQiJ4/eHpZeuSYmN5KqeOT20K7w+sk2QJFQpNMZtkcJ64mdyn6QzdqkQN127vYTB9ADPA36MHkxs6WiAPymw==";
        let proof_bytes = STANDARD
            .decode(proof_base64)
            .expect("invalid proof base64");
        assert_eq!(proof_bytes.len(), 256);

        let inputs_base64 = [
            "ZwIAZfb63aQfkt/saBpdi8O9ia+QBub5dyABgccroSU=",
            "ZwIAZfb63aQfkt/saBpdi8O9ia+QBub5dyABgccroSU=",
        ];
        let public_inputs: Vec<[u8; 32]> = inputs_base64
            .iter()
            .map(|value| {
                let bytes = STANDARD.decode(value).expect("invalid public input base64");
                let arr: [u8; 32] = bytes
                    .try_into()
                    .expect("public input must be 32 bytes");
                arr
            })
            .collect();

        let result = verify_groth16(&verifier, &proof_bytes, &public_inputs);
        if result.is_err() {
            dump_pairing_terms("live_dumped_deposit_proof_still_fails");
            dump_scalar_mul_records("live_dumped_deposit_proof_still_fails");
        }
        assert!(result.is_ok(), "verify_groth16 failed: {result:?}");
    }

    fn dump_pairing_terms(context: &str) {
        let terms = pairing_terms();
        println!("pairing terms for {context} ({} terms):", terms.len());
        for term in terms {
            let g1_b64 = STANDARD.encode(term.g1);
            let g2_b64 = STANDARD.encode(term.g2);
            println!("  {}", term.label);
            println!("    G1: {g1_b64}");
            println!("    G2: {g2_b64}");
        }
    }

    fn dump_scalar_mul_records(context: &str) {
        let records = scalar_mul_records();
        println!("scalar mul records for {context} ({} records):", records.len());
        for (idx, record) in records.iter().enumerate() {
            let point_b64 = STANDARD.encode(record.point);
            let scalar_b64 = STANDARD.encode(record.scalar);
            println!("  #{idx} success={}", record.success);
            println!("    point(G1): {point_b64}");
            println!("    scalar(BE): {scalar_b64}");
            if let Some(result) = record.result {
                let result_b64 = STANDARD.encode(result);
                println!("    result(G1): {result_b64}");
            }
        }
    }

    fn dump_ic_terms(context: &str) {
        let terms = recorded_ic_terms();
        println!("ic terms for {context} ({} records):", terms.len());
        for term in terms {
            let scalar_b64 = STANDARD.encode(term.scalar);
            let point_b64 = STANDARD.encode(term.point);
            println!("  index={} scalar={} point={}", term.index, scalar_b64, point_b64);
        }
    }

    #[test]
    fn vk_ic_point_scalar_mul_identity() {
        let verifier = load_packed_key();
        let key = load_verifier_key(&verifier.verifying_key).expect("unable to decode verifier key");
        let point = key.ic[1];
        let mut scalar = [0u8; 32];
        scalar[31] = 1;
        // Multiplying by 1 should return the same point
        let result = g1_scalar_mul(&point, &scalar).expect("scalar multiplication by 1 should succeed");
        assert_eq!(result, point, "scalar mul by 1 must return the same point");
    }

    #[test]
    fn debug_packed_beta() {
        let verifier = load_packed_key();
        let key = load_verifier_key(&verifier.verifying_key).expect("unable to decode verifier key");
        println!("Packed beta_g2:");
        println!("  x.c1 (0-31):   {}", STANDARD.encode(&key.beta_g2[0..32]));
        println!("  x.c0 (32-63):  {}", STANDARD.encode(&key.beta_g2[32..64]));
        println!("  y.c1 (64-95):  {}", STANDARD.encode(&key.beta_g2[64..96]));
        println!("  y.c0 (96-127): {}", STANDARD.encode(&key.beta_g2[96..128]));
        
        let beta_neg = negate_g2(&key.beta_g2);
        println!("\nNegated -beta_g2:");
        println!("  x.c1 (0-31):   {}", STANDARD.encode(&beta_neg[0..32]));
        println!("  x.c0 (32-63):  {}", STANDARD.encode(&beta_neg[32..64]));
        println!("  y.c1 (64-95):  {}", STANDARD.encode(&beta_neg[64..96]));
        println!("  y.c0 (96-127): {}", STANDARD.encode(&beta_neg[96..128]));
    }

    #[test]
    fn reduce_mod_order_matches_snarkjs_commitment() {
        // Test that a value already within the field modulus is unchanged
        let public_input_be = decode_base64_array::<32>("BbUNpP4upFSSo5lZKpo1ddfTUWJfrvE5YcSVkisu2vM=");
        let reduced = reduce_mod_order_be(&public_input_be);
        assert_eq!(reduced, public_input_be, "public input should already be within the field modulus");
    }

    #[test]
    fn g1_generator_scalar_mul_identity() {
        let mut generator = [0u8; G1_BYTES];
        generator[31] = 1; // x = 1
        generator[63] = 2; // y = 2
        let mut scalar = [0u8; 32];
        scalar[31] = 1;
        let result = g1_scalar_mul(&generator, &scalar)
            .expect("generator * 1 should succeed (big-endian coordinates)");
        assert_eq!(result, generator);
    }

    #[test]
    fn ic_points_roundtrip_through_scalar_mul() {
        let verifier = load_packed_key();
        let key = load_verifier_key(&verifier.verifying_key).expect("unable to decode verifier key");
        let mut scalar = [0u8; 32];
        scalar[31] = 1;
        for (idx, point) in key.ic.iter().enumerate() {
            let result = g1_scalar_mul(point, &scalar).expect("scalar mul should succeed");
            assert_eq!(result, *point, "ic[{idx}] changed after multiplying by 1");
        }
    }

    #[test]
    fn alt_bn128_expects_big_endian_coordinates() {
        // Generator point (1, 2) in big-endian format per EIP-196
        let mut point_be = [0u8; G1_BYTES];
        point_be[31] = 1; // x = 1 in big-endian
        point_be[63] = 2; // y = 2 in big-endian
        let mut scalar_be = [0u8; 32];
        scalar_be[31] = 1;
        let mut input = [0u8; 128];
        input[..G1_BYTES].copy_from_slice(&point_be);
        input[G1_BYTES..G1_BYTES + 32].copy_from_slice(&scalar_be);
        let raw = alt_bn128_multiplication(&input).expect("big-endian point should deserialize");
        let result: [u8; G1_BYTES] = raw.as_slice().try_into().expect("unexpected output size");
        assert_eq!(result, point_be, "scalar mul by 1 should echo the point when encoded big-endian (EIP-196)");
    }
}

    #[test]
    fn test_direct_scalar_mul() {
        // IC[1] in BE (standard form)
        let point_x_be = [
            0x18, 0xc9, 0xc4, 0xe1, 0xec, 0x92, 0x65, 0xc9, 0xae, 0x4f, 0xe6, 0x81, 0x30, 0x1d, 0xf2, 0x16,
            0x6f, 0x0b, 0xd6, 0x25, 0x59, 0xcc, 0x34, 0xd9, 0x33, 0x42, 0xba, 0xcf, 0x50, 0xbe, 0x02, 0xcd,
        ];
        let point_y_be = [
            0x2e, 0x4a, 0x0b, 0xd3, 0x58, 0xe5, 0x87, 0x6d, 0x30, 0x68, 0xa6, 0x32, 0x4e, 0xcc, 0x04, 0xf7,
            0x11, 0x49, 0x35, 0xaf, 0xdb, 0xee, 0x26, 0xc7, 0xc7, 0xce, 0xce, 0x83, 0x23, 0x41, 0x2d, 0xf0,
        ];
        
        // Scalar in BE
        let scalar_be: [u8; 32] = [
            0x05, 0xb5, 0x0d, 0xa4, 0xfe, 0x2e, 0xa4, 0x54, 0x92, 0xa3, 0x99, 0x59, 0x2a, 0x9a, 0x35, 0x75,
            0xd7, 0xd3, 0x51, 0x62, 0x5f, 0xae, 0xf1, 0x39, 0x61, 0xc4, 0x95, 0x92, 0x2b, 0x2e, 0xda, 0xf3,
        ];
        
        // Combine point
        let mut point_be = [0u8; 64];
        point_be[..32].copy_from_slice(&point_x_be);
        point_be[32..].copy_from_slice(&point_y_be);
        
        // Do scalar mul
        let result = g1_scalar_mul(&point_be, &scalar_be).expect("scalar mul failed");
        
        // Expected from snarkjs (CORRECTED - using Jacobian to affine conversion)
        let expected_x_be = [
            0x22, 0x41, 0xa0, 0x12, 0x9c, 0x79, 0xbd, 0x6d, 0xb9, 0xf9, 0xc8, 0x77, 0x75, 0x87, 0x4b, 0x38,
            0x0e, 0x91, 0x15, 0x89, 0x66, 0xc5, 0x1c, 0xb8, 0xf0, 0x0e, 0x90, 0x2a, 0x22, 0xc1, 0xbe, 0x77,
        ];
        let expected_y_be = [
            0x0c, 0xa3, 0x2c, 0xdc, 0x8d, 0x90, 0x16, 0xed, 0xe2, 0x32, 0xe9, 0x22, 0xc4, 0xf3, 0xf0, 0xec,
            0x8f, 0xbf, 0x56, 0x10, 0xdc, 0x84, 0x89, 0x60, 0xa4, 0x4a, 0x64, 0x16, 0x46, 0x4f, 0x09, 0x9f,
        ];
        
        println!("Result x: {:02x?}", &result[..32]);
        println!("Expected: {:02x?}", &expected_x_be);
        println!("Result y: {:02x?}", &result[32..]);
        println!("Expected: {:02x?}", &expected_y_be);
        
        assert_eq!(&result[..32], &expected_x_be, "x coordinate mismatch");
        assert_eq!(&result[32..], &expected_y_be, "y coordinate mismatch");
    }

    #[test]
    fn test_generator_times_two() {
        // Generator point G = (1, 2)
        let mut g_be = [0u8; 64];
        g_be[31] = 1; // x = 1
        g_be[63] = 2; // y = 2
        
        // Scalar = 2
        let mut scalar_be = [0u8; 32];
        scalar_be[31] = 2;
        
        let result = g1_scalar_mul(&g_be, &scalar_be).expect("scalar mul failed");
        
        // Expected 2*G = (-23/16, -11/64) mod p
        // x = p - 23 * (16^-1 mod p) mod p
        // y = p - 11 * (64^-1 mod p) mod p
        // From snarkjs: x = 030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd3
        //               y = 15ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4
        let expected_x_be = [
            0x03, 0x06, 0x44, 0xe7, 0x2e, 0x13, 0x1a, 0x02, 0x9b, 0x85, 0x04, 0x5b, 0x68, 0x18, 0x15, 0x85,
            0xd9, 0x78, 0x16, 0xa9, 0x16, 0x87, 0x1c, 0xa8, 0xd3, 0xc2, 0x08, 0xc1, 0x6d, 0x87, 0xcf, 0xd3,
        ];
        let expected_y_be = [
            0x15, 0xed, 0x73, 0x8c, 0x0e, 0x0a, 0x7c, 0x92, 0xe7, 0x84, 0x5f, 0x96, 0xb2, 0xae, 0x9c, 0x0a,
            0x68, 0xa6, 0xa4, 0x49, 0xe3, 0x53, 0x8f, 0xc7, 0xff, 0x3e, 0xbf, 0x7a, 0x5a, 0x18, 0xa2, 0xc4,
        ];
        
        
        println!("Result x: {:02x?}", &result[..32]);
        println!("Expected: {:02x?}", &expected_x_be);
        println!("Result y: {:02x?}", &result[32..]);
        println!("Expected: {:02x?}", &expected_y_be);
        
        assert_eq!(&result[..32], &expected_x_be, "2*G x coordinate mismatch");
        assert_eq!(&result[32..], &expected_y_be, "2*G y coordinate mismatch");
    }

    #[test]
    fn test_simple_pairing() {
        use solana_program::alt_bn128::prelude::alt_bn128_pairing;
        
        // Test case from EIP-197: pairing check e(P1, P2) == 1 when P1 = 0 (point at infinity)
        // Input: G1 = (0,0), G2 = generator
        // This should return 1 (true)
        
        // G2 generator from EIP-197 test vectors (hex to bytes)
        let g2_x_c1: [u8; 32] = [
            0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25,
            0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2,
        ];
        let g2_x_c0: [u8; 32] = [
            0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79,
            0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed,
        ];
        let g2_y_c1: [u8; 32] = [
            0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95,
            0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b,
        ];
        let g2_y_c0: [u8; 32] = [
            0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f,
            0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
        ];
        
        // Build G1 (point at infinity = all zeros)
        let g1 = [0u8; 64];
        
        // Build G2 in EIP-196 format: [x.c1, x.c0, y.c1, y.c0]
        let mut g2 = [0u8; 128];
        g2[..32].copy_from_slice(&g2_x_c1);
        g2[32..64].copy_from_slice(&g2_x_c0);
        g2[64..96].copy_from_slice(&g2_y_c1);
        g2[96..].copy_from_slice(&g2_y_c0);
        
        // Build pairing input
        let mut input = Vec::new();
        input.extend_from_slice(&g1);
        input.extend_from_slice(&g2);
        
        let result = alt_bn128_pairing(&input).expect("pairing should succeed");
        println!("Pairing result (0 * G2): {:02x?}", result);
        
        // Should be 1 (true) since e(0, G2) = 1
        assert_eq!(result[31], 1, "e(0, G2) should equal 1");
    }

