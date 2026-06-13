import { z } from 'zod';

export const RemoteType = z.enum(['onsite', 'remote', 'hybrid']);
export const Lang = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']);

export const VacancySchema = z.object({
  title: z.string(),
  company: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  remote_type: RemoteType.nullable(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  salary_currency: z.string().nullable(),
  skills: z.array(z.string()),
  apply_contact: z.string().nullable(),
  lang: Lang,
});

export const ExtractionResultSchema = z.object({
  is_job_post: z.boolean(),
  vacancies: z.array(VacancySchema),
});

export type Vacancy = z.infer<typeof VacancySchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const EXTRACTION_TOOL = {
  name: 'extract_vacancies',
  description:
    'Extract structured job vacancies from a raw post. If the post is not a job vacancy, return is_job_post=false and an empty vacancies array. Never invent fields — use null when a value is absent.',
  input_schema: {
    type: 'object',
    properties: {
      is_job_post: { type: 'boolean' },
      vacancies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            description: { type: 'string' },
            location: { type: ['string', 'null'] },
            remote_type: { enum: ['onsite', 'remote', 'hybrid', null] },
            salary_min: { type: ['number', 'null'] },
            salary_max: { type: ['number', 'null'] },
            salary_currency: { type: ['string', 'null'] },
            skills: { type: 'array', items: { type: 'string' } },
            apply_contact: { type: ['string', 'null'] },
            lang: { enum: ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] },
          },
          required: ['title', 'company', 'description', 'skills', 'lang'],
        },
      },
    },
    required: ['is_job_post', 'vacancies'],
  },
} as const;
