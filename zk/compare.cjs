const testProof = Buffer.from('BPN0T9GKkKkLhOBagJaHdPuDRwmHQRW0Hmb+PmJu/5AfQIVrEf4hbitHR9dvJiTzQ613U2AqdlOA74uEj6Jo7xKM72AZ0bn55vL/sLPgoI2tAjNy3yxPNX0tgq4HGJOlE/GDt8+7bODqGIakx2XICrwi5J9Y3OwJHZi5dY/RlacHPvJine66UNbrQBCUJzzfLW0dz1oQ0CoYZbJlQ5lo8iqHHOzFeN4LovAP/Ptp0ud9jqjcgyYoekhcJgVAHCtXI8bq1G9LWxVYnK8q1+4ENEfsKHEeGrXbC/kcUozWS6cWGsdpRlsJYGeGDS9IAVbpfj5kHFcNrILa/BiBIgUSbQ==', 'base64');
const genProof = Buffer.from('BPN0T9GKkKkLhOBagJaHdPuDRwmHQRW0Hmb+PmJu/5AfQIVrEf4hbitHR9dvJiTzQ613U2AqdlOA74uEj6Jo7xPxg7fPu2zg6hiGpMdlyAq8IuSfWNzsCR2YuXWP0ZWnEozvYBnRufnm8v+ws+Cgja0CM3LfLE81fS2CrgcYk6UqhxzsxXjeC6LwD/z7adLnfY6o3IMmKHpIXCYFQBwrVwc+8mKd7rpQ1utAEJQnPN8tbR3PWhDQKhhlsmVDmWjyI8bq1G9LWxVYnK8q1+4ENEfsKHEeGrXbC/kcUozWS6cWGsdpRlsJYGeGDS9IAVbpfj5kHFcNrILa/BiBIgUSbQ==', 'base64');

console.log('pi_a (0-63): match?', testProof.slice(0, 64).equals(genProof.slice(0, 64)));
console.log('pi_b (64-191): match?', testProof.slice(64, 192).equals(genProof.slice(64, 192)));
console.log('pi_c (192-255): match?', testProof.slice(192, 256).equals(genProof.slice(192, 256)));

console.log('\npi_b test:', testProof.slice(64, 192).toString('hex'));
console.log('pi_b gen: ', genProof.slice(64, 192).toString('hex'));
