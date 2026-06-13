import { describe, it, expect } from 'vitest';
import { VacancySchema, ExtractionResultSchema, EXTRACTION_TOOL } from './schema.js';

describe('VacancySchema', () => {
  const validVacancy = {
    title: 'Backend Developer',
    company: 'Acme LLC',
    description: 'We need a backend developer.',
    location: 'Tashkent',
    remote_type: 'hybrid' as const,
    salary_min: 1000,
    salary_max: 2000,
    salary_currency: 'USD',
    skills: ['Node.js', 'TypeScript'],
    apply_contact: '@acmejobs',
    lang: 'en' as const,
  };

  it('parses a valid vacancy object', () => {
    const result = VacancySchema.safeParse(validVacancy);
    expect(result.success).toBe(true);
  });

  it('accepts null for nullable fields', () => {
    const vacancy = {
      ...validVacancy,
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      apply_contact: null,
    };
    const result = VacancySchema.safeParse(vacancy);
    expect(result.success).toBe(true);
  });

  it('rejects remote_type "fulltime" (invalid enum)', () => {
    const vacancy = { ...validVacancy, remote_type: 'fulltime' };
    const result = VacancySchema.safeParse(vacancy);
    expect(result.success).toBe(false);
  });

  it('strips unknown keys (not present in parsed output)', () => {
    const vacancyWithExtra = { ...validVacancy, fabricatedField: 'should-be-stripped' };
    const result = VacancySchema.safeParse(vacancyWithExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).fabricatedField).toBeUndefined();
    }
  });

  it('accepts lang uz-Latn', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, lang: 'uz-Latn' });
    expect(result.success).toBe(true);
  });

  it('accepts lang uz-Cyrl', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, lang: 'uz-Cyrl' });
    expect(result.success).toBe(true);
  });

  it('accepts lang ru', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, lang: 'ru' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid lang value', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, lang: 'fr' });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional salary_min (INTEGER column)', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, salary_min: 1500.5 });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional salary_max (INTEGER column)', () => {
    const result = VacancySchema.safeParse({ ...validVacancy, salary_max: 2000.25 });
    expect(result.success).toBe(false);
  });
});

describe('ExtractionResultSchema', () => {
  it('parses { is_job_post: false, vacancies: [] } (non-job path)', () => {
    const result = ExtractionResultSchema.safeParse({ is_job_post: false, vacancies: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_job_post).toBe(false);
      expect(result.data.vacancies).toEqual([]);
    }
  });

  it('parses a single-job result', () => {
    const singleJob = {
      is_job_post: true,
      vacancies: [
        {
          title: 'Frontend Dev',
          company: 'TechCo',
          description: 'Build UIs.',
          location: null,
          remote_type: 'remote',
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          skills: ['React'],
          apply_contact: null,
          lang: 'en',
        },
      ],
    };
    const result = ExtractionResultSchema.safeParse(singleJob);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vacancies).toHaveLength(1);
    }
  });

  it('parses a 3-vacancy array (multi-job common case)', () => {
    const makeVacancy = (title: string) => ({
      title,
      company: 'Corp',
      description: 'Job description.',
      location: null,
      remote_type: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      skills: [],
      apply_contact: null,
      lang: 'ru',
    });
    const result = ExtractionResultSchema.safeParse({
      is_job_post: true,
      vacancies: [makeVacancy('Job 1'), makeVacancy('Job 2'), makeVacancy('Job 3')],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vacancies).toHaveLength(3);
    }
  });
});

describe('EXTRACTION_TOOL', () => {
  it('has a plain JSON Schema input_schema (not a Zod type)', () => {
    expect(typeof EXTRACTION_TOOL.input_schema).toBe('object');
    expect(EXTRACTION_TOOL.input_schema.type).toBe('object');
  });

  it('input_schema required array lists is_job_post and vacancies', () => {
    const required = EXTRACTION_TOOL.input_schema.required;
    expect(required).toContain('is_job_post');
    expect(required).toContain('vacancies');
  });

  it('vacancies.items.required lists title, company, description, skills, lang', () => {
    const itemsRequired = EXTRACTION_TOOL.input_schema.properties.vacancies.items.required;
    expect(itemsRequired).toContain('title');
    expect(itemsRequired).toContain('company');
    expect(itemsRequired).toContain('description');
    expect(itemsRequired).toContain('skills');
    expect(itemsRequired).toContain('lang');
  });

  it('has a name of extract_vacancies', () => {
    expect(EXTRACTION_TOOL.name).toBe('extract_vacancies');
  });
});
