import { SubscriptionTier, BillingCadence } from '@prisma/client';

export interface PlanConfig {
  tier: SubscriptionTier;
  name: string;
  nameAm: string;
  monthlyPriceSantims: bigint; // e.g. 120_000n = 1,200 ETB
  quarterlyPriceSantims: bigint; // 10% discount: e.g. 324_000n = 3,240 ETB (1,080/mo)
  annualPriceSantims: bigint; // 20% discount: e.g. 11,520 ETB
  maxActiveStudents: number;
  maxStaffSeats: number;
  monthlySmsQuota: number;
  features: string[];
  featuresAm: string[];
}

export const PLAN_CONFIGS: Record<SubscriptionTier, PlanConfig> = {
  STARTER: {
    tier: SubscriptionTier.STARTER,
    name: 'Starter',
    nameAm: 'ጀማሪ',
    monthlyPriceSantims: 120_000n, // 1,200.00 ETB
    quarterlyPriceSantims: 324_000n, // 3,240.00 ETB (1,080/mo, 10% off)
    annualPriceSantims: 1_152_000n, // 11,520.00 ETB (960/mo, 20% off)
    maxActiveStudents: 100,
    maxStaffSeats: 1,
    monthlySmsQuota: 200,
    features: [
      'Up to 100 active students',
      'Course & batch management',
      'Daily attendance tracking',
      'Standard receipt generation',
      'Single administrator seat',
    ],
    featuresAm: [
      'እስከ 100 ንቁ ተማሪዎች',
      'የኮርስ እና የክፍል አስተዳደር',
      'የዕለት ተዕለት የክትትል ምዝገባ',
      'መደበኛ የደረሰኝ ማመንጨት',
      'አንድ የአስተዳዳሪ መቀመጫ',
    ],
  },
  GROWTH: {
    tier: SubscriptionTier.GROWTH,
    name: 'Growth',
    nameAm: 'እድገት',
    monthlyPriceSantims: 240_000n, // 2,400.00 ETB
    quarterlyPriceSantims: 648_000n, // 6,480.00 ETB (2,160/mo, 10% off)
    annualPriceSantims: 2_304_000n, // 23,040.00 ETB (1,920/mo, 20% off)
    maxActiveStudents: 250,
    maxStaffSeats: 5,
    monthlySmsQuota: 1000,
    features: [
      'Up to 250 active students',
      'Automated SMS fee reminders',
      'Custom attendance registers',
      'Instalment payment schedules',
      'Up to 5 staff member seats',
    ],
    featuresAm: [
      'እስከ 250 ንቁ ተማሪዎች',
      'አውቶማቲክ የአጭር የጽሁፍ ማስታወሻዎች',
      'ልዩ የክትትል መመዝገቢያዎች',
      'የክፍያ ክፍፍል መርሃ-ግብሮች',
      'እስከ 5 የሰራተኞች መቀመጫዎች',
    ],
  },
  PRO: {
    tier: SubscriptionTier.PRO,
    name: 'Pro',
    nameAm: 'ሙያዊ',
    monthlyPriceSantims: 480_000n, // 4,800.00 ETB
    quarterlyPriceSantims: 1_296_000n, // 12,960.00 ETB (4,320/mo, 10% off)
    annualPriceSantims: 4_608_000n, // 46,080.00 ETB (3,840/mo, 20% off)
    maxActiveStudents: 1000,
    maxStaffSeats: 25,
    monthlySmsQuota: 3000,
    features: [
      'Up to 1,000 active students',
      'Official QR verified certificates',
      'Advanced revenue & attendance reports',
      'Automated batch notifications',
      'Up to 25 staff member seats',
    ],
    featuresAm: [
      'እስከ 1,000 ንቁ ተማሪዎች',
      'በQR የተረጋገጡ ይፋዊ ሰርተፊኬቶች',
      'የላቀ የገቢ እና የክትትል ሪፖርቶች',
      'አውቶማቲክ የቡድን ማሳወቂያዎች',
      'እስከ 25 የሰራተኞች መቀመጫዎች',
    ],
  },
};

export function getPriceSantims(tier: SubscriptionTier, cadence: BillingCadence): bigint {
  const plan = PLAN_CONFIGS[tier] || PLAN_CONFIGS.STARTER;
  switch (cadence) {
    case BillingCadence.QUARTERLY:
      return plan.quarterlyPriceSantims;
    case BillingCadence.ANNUAL:
      return plan.annualPriceSantims;
    case BillingCadence.MONTHLY:
    default:
      return plan.monthlyPriceSantims;
  }
}

export function getCadenceMonths(cadence: BillingCadence): number {
  switch (cadence) {
    case BillingCadence.QUARTERLY:
      return 3;
    case BillingCadence.ANNUAL:
      return 12;
    case BillingCadence.MONTHLY:
    default:
      return 1;
  }
}
