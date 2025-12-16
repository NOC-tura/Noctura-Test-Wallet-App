const expected = Buffer.from('JjrW4ye1uiQSrb7zhnnozlNNV2ZaZBkeNZsMlfUy9Us=', 'base64');
const rust     = Buffer.from('JjrW4ye1uiQSrb7zhnnozeP/1R1rq78iPVx2Ewy1+AU=', 'base64');

console.log('Expected -y.c1:', expected.toString('hex'));
console.log('Rust -y.c1:    ', rust.toString('hex'));

// They differ starting at byte 14
console.log('\nByte-by-byte comparison:');
for (let i = 0; i < 32; i++) {
    if (expected[i] !== rust[i]) {
        console.log(`  Byte ${i}: expected ${expected[i].toString(16).padStart(2,'0')} vs rust ${rust[i].toString(16).padStart(2,'0')}`);
    }
}
