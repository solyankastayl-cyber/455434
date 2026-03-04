/**
 * BLOCK 29.30: Beta Distribution Utils for Bayesian Calibration
 * Lightweight beta quantile approximation using Lanczos + continued fraction
 */

function logGamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) {
    x += p[i] / (z + i + 1);
  }
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }

  return h;
}

export function regIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lb = logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log(1 - x);

  const bt = Math.exp(lb);

  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(a, b, x) / a;
  } else {
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
}

export function betaMean(a: number, b: number): number {
  return a / (a + b);
}

export function betaQuantile(p: number, a: number, b: number): number {
  // Binary search on CDF
  let lo = 0, hi = 1, mid = 0.5;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const cdf = regIncompleteBeta(mid, a, b);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function betaVariance(a: number, b: number): number {
  return (a * b) / ((a + b) ** 2 * (a + b + 1));
}
