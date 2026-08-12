export const lamportsToSol = (lamports?: number) => {
  if (!lamports) return '-';
  return (lamports / 1_000_000_000).toFixed(4);
};

