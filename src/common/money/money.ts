/**
 * Money & Currency Utility
 * Enforces integer santim minor units (1 ETB = 100 santims) to eliminate floating-point drift.
 * Provides formatters and bilingual Amount-in-Words for receipts and certificates.
 */

export function toSantims(etb: number | string): bigint {
  const num = typeof etb === 'string' ? parseFloat(etb.replace(/,/g, '')) : etb;
  if (isNaN(num)) throw new Error(`Invalid ETB amount: ${etb}`);
  return BigInt(Math.round(num * 100));
}

export function fromSantims(santims: bigint | number): number {
  return Number(santims) / 100;
}

export function formatETB(santims: bigint | number, includeSymbol = true): string {
  const amount = Number(santims) / 100;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return includeSymbol ? `${formatted} Br` : formatted;
}

// English Number Words
const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertLessThanOneThousandEn(n: number): string {
  let s = '';
  if (n >= 100) {
    s += EN_ONES[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    s += EN_TENS[Math.floor(n / 10)] + ' ';
    n %= 10;
  }
  if (n > 0) {
    s += EN_ONES[n] + ' ';
  }
  return s.trim();
}

export function amountInWordsEnglish(santims: bigint | number): string {
  const total = BigInt(santims);
  const birr = Number(total / 100n);
  const cents = Number(total % 100n);

  if (birr === 0) return 'Zero Birr';

  let num = birr;
  const parts: string[] = [];

  const billions = Math.floor(num / 1000000000);
  num %= 1000000000;
  if (billions > 0) parts.push(convertLessThanOneThousandEn(billions) + ' Billion');

  const millions = Math.floor(num / 1000000);
  num %= 1000000;
  if (millions > 0) parts.push(convertLessThanOneThousandEn(millions) + ' Million');

  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) parts.push(convertLessThanOneThousandEn(thousands) + ' Thousand');

  if (num > 0) parts.push(convertLessThanOneThousandEn(num));

  let result = parts.join(' ') + ' Birr';
  if (cents > 0) {
    result += ` and ${convertLessThanOneThousandEn(cents)} Cents`;
  }
  return result;
}

// Amharic Number Words
const AM_ONES = ['', 'አንድ', 'ሁለት', 'ሦስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ'];
const AM_TENS = ['', 'አስር', 'ሃያ', 'ሠላሳ', 'አርባ', 'ሀምሳ', 'ስልሳ', 'ሰባ', 'ሰማንያ', 'ዘጠና'];

function convertLessThanOneThousandAm(n: number): string {
  let s = '';
  if (n >= 100) {
    s += (AM_ONES[Math.floor(n / 100)] || '') + ' መቶ ';
    n %= 100;
  }
  if (n >= 10) {
    s += (AM_TENS[Math.floor(n / 10)] || '') + ' ';
    n %= 10;
  }
  if (n > 0) {
    s += (AM_ONES[n] || '') + ' ';
  }
  return s.trim();
}

export function amountInWordsAmharic(santims: bigint | number): string {
  const total = BigInt(santims);
  const birr = Number(total / 100n);
  const cents = Number(total % 100n);

  if (birr === 0) return 'ዜሮ ብር';

  let num = birr;
  const parts: string[] = [];

  const millions = Math.floor(num / 1000000);
  num %= 1000000;
  if (millions > 0) parts.push(convertLessThanOneThousandAm(millions) + ' ሚሊዮን');

  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) parts.push(convertLessThanOneThousandAm(thousands) + ' ሺህ');

  if (num > 0) parts.push(convertLessThanOneThousandAm(num));

  let result = parts.join(' ') + ' ብር';
  if (cents > 0) {
    result += ` ከ ${convertLessThanOneThousandAm(cents)} ሳንቲም`;
  }
  return result;
}
