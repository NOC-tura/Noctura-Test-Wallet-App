const rust_g2 = Buffer.from('HI1pAVWZIkRk5H1wFuDHOJs2/X0vtobPdc5IWtJPOIksz9ehzMvRw29GRnkz48EGmN4T7RXBNKOLd6s7oNrvBxRRtApIp5hZvYPwnhsMWVhfD2K9eE/9aQYdpWvPz9XsJjrW4ye1uiQSrb7zhnnozeP/1R1rq78iPVx2Ewy1+AU=', 'base64');
const js_g2 = Buffer.from('LM/XoczL0cNvRkZ5M+PBBpjeE+0VwTSji3erO6Da7wccjWkBVZkiRGTkfXAW4Mc4mzb9fS+2hs91zkha0k84iSY61uMntbokEq2+84Z56M5TTVdmWmQZHjWbDJX1MvVLFFG0CkinmFm9g/CeGwxZWM5c5QZnCFdk/lw77rhM0zI=', 'base64');

console.log('Rust -beta (128 bytes):');
console.log('  x.c1 (0-31):', rust_g2.slice(0, 32).toString('hex'));
console.log('  x.c0 (32-63):', rust_g2.slice(32, 64).toString('hex'));
console.log('  y.c1 (64-95):', rust_g2.slice(64, 96).toString('hex'));
console.log('  y.c0 (96-127):', rust_g2.slice(96, 128).toString('hex'));

console.log('\nJS -beta (128 bytes):');
console.log('  x.c1 (0-31):', js_g2.slice(0, 32).toString('hex'));
console.log('  x.c0 (32-63):', js_g2.slice(32, 64).toString('hex'));
console.log('  y.c1 (64-95):', js_g2.slice(64, 96).toString('hex'));
console.log('  y.c0 (96-127):', js_g2.slice(96, 128).toString('hex'));

console.log('\nMatches:');
console.log('  x.c1:', rust_g2.slice(0, 32).equals(js_g2.slice(0, 32)));
console.log('  x.c0:', rust_g2.slice(32, 64).equals(js_g2.slice(32, 64)));
console.log('  y.c1:', rust_g2.slice(64, 96).equals(js_g2.slice(64, 96)));
console.log('  y.c0:', rust_g2.slice(96, 128).equals(js_g2.slice(96, 128)));
