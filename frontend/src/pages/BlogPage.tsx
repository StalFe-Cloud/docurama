import React, { useEffect, useMemo } from 'react';
import { BLOG_POSTS } from '../content/blog';
import { useLocalizedPost, useBlogTagLabel, useCategoryLabel } from '../content/localize';
import { useI18n } from '../i18n';
import { ArrowLeft, Clock, Newspaper } from 'lucide-react';

/** Blog index + post reader (Sprint 8). Public route: /blog and /blog/<slug>. */
export const BlogPage: React.FC<{ slug?: string; onNavigate?: (tab: string) => void }> = ({ slug, onNavigate }) => {
  const { t } = useI18n();
  const post = useMemo(() => BLOG_POSTS.find((p) => p.slug === slug), [slug]);

  if (post) {
    return (
      <PostView
        slug={post.slug}
        onBack={() => {
          window.history.pushState({}, '', '/blog');
          onNavigate?.('blog');
        }}
      />
    );
  }

  const sorted = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date));
  const featured = sorted.find((p) => p.featured);
  const rest = sorted.filter((p) => p !== featured);

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold text-[#1a1a1a]">{t('blog.title')}</h1>
        <p className="mt-2 text-sm text-[#5d5b54] leading-6">{t('blog.sub')}</p>
      </header>

      {featured && <PostCard slug={featured.slug} featured />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rest.map((p) => (
          <PostCard key={p.slug} slug={p.slug} />
        ))}
      </div>
    </div>
  );
};

const PostCard: React.FC<{ slug: string; featured?: boolean }> = ({ slug, featured }) => {
  const base = BLOG_POSTS.find((p) => p.slug === slug)!;
  const post = useLocalizedPost(base);
  const { t } = useI18n();
  const tagLabel = useBlogTagLabel();

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    window.history.pushState({}, '', `/blog/${slug}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  if (featured) {
    return (
      <a
        href={`/blog/${slug}`}
        onClick={open}
        className="group grid md:grid-cols-3 gap-6 rounded-xl border border-[#e5e3df] bg-white p-6 hover:border-[#a4a097] transition-all"
      >
        <div className="md:col-span-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">
            <Newspaper className="w-3.5 h-3.5" /> {t('blog.featured')} · {tagLabel(post.tag)}
          </span>
          <h2 className="mt-2 text-xl md:text-2xl font-bold text-[#1a1a1a] group-hover:text-[#5645d4] transition-colors text-balance">
            {post.title}
          </h2>
          <p className="mt-2 text-sm text-[#5d5b54] leading-6">{post.description}</p>
          <p className="mt-3 text-[11px] text-[#787671] flex items-center gap-1">
            <Clock className="w-3 h-3" /> {post.date} · {post.minutes} {t('docs.min')}
          </p>
        </div>
        <div className="hidden md:flex items-center justify-center">
          <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-[#f3f0fb] to-[#dcecfa] flex items-center justify-center">
            <Newspaper className="w-12 h-12 text-[#5645d4]/60" />
          </div>
        </div>
      </a>
    );
  }

  return (
    <a
      href={`/blog/${slug}`}
      onClick={open}
      className="group rounded-xl border border-[#e5e3df] bg-white p-5 hover:border-[#a4a097] transition-all flex flex-col"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">{tagLabel(post.tag)}</span>
      <h3 className="mt-1.5 text-sm font-bold text-[#1a1a1a] group-hover:text-[#5645d4] transition-colors">{post.title}</h3>
      <p className="mt-1.5 text-xs text-[#5d5b54] leading-5 line-clamp-3">{post.description}</p>
      <p className="mt-3 text-[10px] text-[#787671] flex items-center gap-1 mt-auto">
        <Clock className="w-3 h-3" /> {post.date} · {post.minutes} {t('docs.min')}
      </p>
    </a>
  );
};

const PostView: React.FC<{ slug: string; onBack: () => void }> = ({ slug, onBack }) => {
  const base = BLOG_POSTS.find((p) => p.slug === slug)!;
  const post = useLocalizedPost(base);
  const { t } = useI18n();
  const tagLabel = useBlogTagLabel();

  useEffect(() => {
    document.title = `${post.title} - Docurama Blog`;
    return () => {
      document.title = 'Docurama: Secure Electronic Signatures';
    };
  }, [post.title]);

  return (
    <article className="max-w-3xl mx-auto">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5645d4] hover:underline">
        <ArrowLeft className="w-3.5 h-3.5" /> {t('blog.title')}
      </button>
      <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5645d4]">
        <Newspaper className="w-3.5 h-3.5" /> {tagLabel(post.tag)}
      </div>
      <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-[#1a1a1a] text-balance">{post.title}</h1>
      <p className="mt-2 text-[11px] text-[#787671]">
        {post.date} · {post.minutes} {t('docs.min')}
      </p>
      <div className="mt-6 space-y-5">
        {post.blocks.map((b, i) => (
          <div key={i}>
            {b.h2 && <h2 className="text-base font-bold text-[#1a1a1a] mb-1.5">{b.h2}</h2>}
            {b.p && <p className="text-sm text-[#37352f] leading-7" dangerouslySetInnerHTML={{ __html: b.p }} />}
            {b.list && (
              <ul className="mt-1 space-y-1.5">
                {b.list.map((li, j) => (
                  <li key={j} className="text-sm text-[#37352f] leading-6 flex gap-2">
                    <span className="text-[#5645d4] mt-px">•</span>
                    <span dangerouslySetInnerHTML={{ __html: li }} />
                  </li>
                ))}
              </ul>
            )}
            {b.callout && (
              <div className="mt-3 rounded-lg border border-[#e5e3df] bg-[#f6f5f4] px-4 py-3 text-xs text-[#37352f] leading-6">
                {b.callout}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
};
