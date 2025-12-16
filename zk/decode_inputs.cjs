const test = Buffer.from('89ouK5KVxGE58a5fYlHT13U1mipZmaOSVKQu/qQNtQU=', 'base64');
const gen = Buffer.from('BbUNpP4upFSSo5lZKpo1ddfTUWJfrvE5YcSVkisu2vM=', 'base64');

// Convert to big-endian decimal
function bufToBigInt(buf) {
    let result = 0n;
    for (const byte of buf) {
        result = (result << 8n) + BigInt(byte);
    }
    return result;
}

console.log('Test input as decimal:', bufToBigInt(test).toString());
console.log('Gen input as decimal: ', bufToBigInt(gen).toString());
console.log('Expected commitment:   ', '2581457732543490650489463419642702944727152925403264259866487982970800888563');

// Also check reversed
function bufToLeBigInt(buf) {
    let result = 0n;
    for (let i = buf.length - 1; i >= 0; i--) {
        result = (result << 8n) + BigInt(buf[i]);
    }
    return result;
}

console.log('\nTest input as LE decimal:', bufToLeBigInt(test).toString());
console.log('Gen input as LE decimal: ', bufToLeBigInt(gen).toString());
