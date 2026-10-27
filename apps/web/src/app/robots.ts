import type { MetadataRoute } from 'next';
import { site } from '@/marketing/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/', '/demo'], disallow: ['/login', '/dashboard', '/candidate', '/file', '/auth', '/verify'] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
