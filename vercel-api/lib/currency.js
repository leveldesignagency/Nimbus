/**
 * Get currency and price for subscription based on request location.
 * Uses Vercel's X-Vercel-IP-Country header (set automatically in production).
 * Price is 2.49 in local currency; amount in smallest unit (cents/pence) for Stripe.
 */
const PRICE_UNIT_AMOUNT = 249; // 2.49 in cents/pence

// Country code (ISO 3166-1 alpha-2) -> Stripe currency code
const COUNTRY_TO_CURRENCY = {
  US: 'usd',
  GB: 'gbp',
  CA: 'cad',
  AU: 'aud',
  NZ: 'nzd',
  CH: 'chf',
  // Eurozone
  AT: 'eur', BE: 'eur', CY: 'eur', DE: 'eur', EE: 'eur', ES: 'eur', FI: 'eur',
  FR: 'eur', GR: 'eur', IE: 'eur', IT: 'eur', LT: 'eur', LU: 'eur', LV: 'eur',
  MT: 'eur', NL: 'eur', PT: 'eur', SI: 'eur', SK: 'eur',
  // Other European countries often prefer EUR for online
  PL: 'eur', RO: 'eur', HU: 'eur', CZ: 'eur', BG: 'eur', HR: 'eur',
  SE: 'eur', DK: 'eur', NO: 'eur', IS: 'eur',
  // Rest of world defaults
  JP: 'jpy', IN: 'inr', BR: 'brl', MX: 'mxn', ZA: 'zar', SG: 'sgd',
};

/**
 * @param {object} req - Vercel request object (req.headers)
 * @returns {{ currency: string, unitAmount: number, productLabel: string }}
 */
function getCurrencyFromRequest(req) {
  const country = (req.headers['x-vercel-ip-country'] || '').toUpperCase() || 'GB';
  const currency = COUNTRY_TO_CURRENCY[country] || 'gbp';

  // Stripe: JPY has no decimals (249 = 249 yen), most others use 249 = 2.49
  const unitAmount = currency === 'jpy' ? 249 : PRICE_UNIT_AMOUNT; // 249 yen or 2.49

  const labels = {
    gbp: '£2.49/year',
    usd: '$2.49/year',
    eur: '€2.49/year',
    cad: 'C$2.49/year',
    aud: 'A$2.49/year',
    nzd: 'NZ$2.49/year',
    chf: 'CHF 2.49/year',
    jpy: '¥249/year',
    inr: '₹249/year',
    brl: 'R$2.49/year',
    mxn: 'MX$2.49/year',
    zar: 'R2.49/year',
    sgd: 'S$2.49/year',
  };
  const productLabel = labels[currency] || '2.49/year';

  return { currency, unitAmount, productLabel, country };
}

export { getCurrencyFromRequest, PRICE_UNIT_AMOUNT };
