export function fieldToBytesLE(value) {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return bytes;
}
export function fieldToBytesBE(value) {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    return bytes;
}
export function fieldsToHex(values) {
    return values.map((v) => '0x' + v.toString(16).padStart(64, '0'));
}
