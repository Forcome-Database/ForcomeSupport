import { z } from 'zod';

/** 币种：北美三站的原币（USD、CAD、MXN），美元为折算与报表口径（R-AS-08） */
export const currencies = ['USD', 'CAD', 'MXN'] as const;
export const currencySchema = z.enum(currencies);
export type Currency = z.infer<typeof currencySchema>;
