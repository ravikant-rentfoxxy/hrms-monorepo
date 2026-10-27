import type { MetadataRoute } from 'next';
import { site } from '@/marketing/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${site.url}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${site.url}/demo`, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
