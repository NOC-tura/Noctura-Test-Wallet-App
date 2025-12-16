#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::vec::Vec;
use core::marker::PhantomData;

pub const HASH_LEN: usize = 32;
pub const MAX_X5_LEN: usize = 13;
const UNSUPPORTED_WIDTH: usize = MAX_X5_LEN + 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PoseidonError {
    InvalidNumberOfInputs {
        inputs: usize,
        max_limit: usize,
        width: usize,
    },
    EmptyInput,
    InvalidInputLength {
        len: usize,
        modulus_bytes_len: usize,
    },
    BytesToPrimeFieldElement {
        bytes: Vec<u8>,
    },
    InputLargerThanModulus,
    VecToArray,
    U64Tou8,
    BytesToBigInt,
    InvalidWidthCircom {
        width: usize,
        max_limit: usize,
    },
}

impl core::fmt::Display for PoseidonError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            PoseidonError::InvalidNumberOfInputs { inputs, max_limit, width } => {
                write!(f, "invalid number of inputs {inputs}, expected {} for width {width}", max_limit)
            }
            PoseidonError::EmptyInput => write!(f, "input is empty"),
            PoseidonError::InvalidInputLength { len, modulus_bytes_len } => {
                write!(f, "invalid input length {len}, expected {modulus_bytes_len}")
            }
            PoseidonError::BytesToPrimeFieldElement { .. } => {
                write!(f, "failed to convert bytes to field element")
            }
            PoseidonError::InputLargerThanModulus => write!(f, "input larger than modulus"),
            PoseidonError::VecToArray => write!(f, "failed to convert vec to array"),
            PoseidonError::U64Tou8 => write!(f, "failed to convert u64 to u8"),
            PoseidonError::BytesToBigInt => write!(f, "failed to convert bytes to bigint"),
            PoseidonError::InvalidWidthCircom { width, max_limit } => {
                write!(f, "invalid width {width}, supported range is 2..={max_limit}")
            }
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for PoseidonError {}

pub trait PoseidonHasher<F> {
    fn hash(&mut self, inputs: &[F]) -> Result<F, PoseidonError>;
}

pub trait PoseidonBytesHasher {
    fn hash_bytes_be(&mut self, inputs: &[&[u8]]) -> Result<[u8; HASH_LEN], PoseidonError>;
    fn hash_bytes_le(&mut self, inputs: &[&[u8]]) -> Result<[u8; HASH_LEN], PoseidonError>;
}

pub struct Poseidon<F> {
    width: usize,
    _marker: PhantomData<F>,
}

impl<F> Poseidon<F> {
    pub fn new_circom(inputs: usize) -> Result<Self, PoseidonError> {
        let width = inputs + 1;
        if width < 2 || width > MAX_X5_LEN {
            return Err(PoseidonError::InvalidWidthCircom {
                width,
                max_limit: MAX_X5_LEN,
            });
        }

        Ok(Self {
            width,
            _marker: PhantomData,
        })
    }

    fn validate_inputs(&self, inputs: &[&[u8]]) -> Result<(), PoseidonError> {
        if inputs.is_empty() {
            return Err(PoseidonError::EmptyInput);
        }

        let max_inputs = self.width.saturating_sub(1);
        if inputs.len() != max_inputs {
            return Err(PoseidonError::InvalidNumberOfInputs {
                inputs: inputs.len(),
                max_limit: max_inputs,
                width: self.width,
            });
        }

        for slice in inputs {
            if slice.is_empty() {
                return Err(PoseidonError::EmptyInput);
            }
            if slice.len() != HASH_LEN {
                return Err(PoseidonError::InvalidInputLength {
                    len: slice.len(),
                    modulus_bytes_len: HASH_LEN,
                });
            }
        }

        Ok(())
    }

    fn unsupported_hash() -> Result<[u8; HASH_LEN], PoseidonError> {
        Err(PoseidonError::InvalidWidthCircom {
            width: UNSUPPORTED_WIDTH,
            max_limit: MAX_X5_LEN,
        })
    }
}

impl<F: Copy> PoseidonHasher<F> for Poseidon<F> {
    fn hash(&mut self, inputs: &[F]) -> Result<F, PoseidonError> {
        let _ = inputs;
        Err(PoseidonError::InvalidWidthCircom {
            width: self.width,
            max_limit: MAX_X5_LEN,
        })
    }
}

impl<F> PoseidonBytesHasher for Poseidon<F> {
    fn hash_bytes_be(&mut self, inputs: &[&[u8]]) -> Result<[u8; HASH_LEN], PoseidonError> {
        self.validate_inputs(inputs)?;
        Self::unsupported_hash()
    }

    fn hash_bytes_le(&mut self, inputs: &[&[u8]]) -> Result<[u8; HASH_LEN], PoseidonError> {
        self.validate_inputs(inputs)?;
        Self::unsupported_hash()
    }
}

/// Placeholder module provided to satisfy downstream imports.
pub mod parameters {}
