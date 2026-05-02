/// Display helpers — Roman numerals for plate numbers and verdict glyphs,
/// short hex truncation for tx hashes / nullifiers.

export function toRoman(n: number): string {
  const values: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"],  [90, "XC"], [50, "L"],  [40, "XL"],
    [10, "X"],   [9, "IX"],  [5, "V"],   [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rem = n;
  for (const [v, s] of values) {
    while (rem >= v) {
      out += s;
      rem -= v;
    }
  }
  return out;
}

export function truncHex(hex: string, leading = 6, trailing = 4): string {
  if (!hex) return "";
  const s = hex.startsWith("0x") ? hex : `0x${hex}`;
  if (s.length <= leading + trailing + 2) return s;
  return `${s.slice(0, 2 + leading)}…${s.slice(-trailing)}`;
}

export function explorerTxUrl(txHash: string): string {
  return `https://chainscan-galileo.0g.ai/tx/${txHash}`;
}

export function explorerAddrUrl(addr: string): string {
  return `https://chainscan-galileo.0g.ai/address/${addr}`;
}
