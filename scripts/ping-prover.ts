async function main() {
  const res = await fetch('http://localhost:8787/health');
  console.log('status', res.status);
  console.log(await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
