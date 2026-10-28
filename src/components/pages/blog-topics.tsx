import Link from "next/link";
import { BlogLayout } from "@/components/blog/blog-layout";
import { blogTagCloud, getBlogTopic } from "@/lib/blog";
export const dynamic="force-dynamic";
export default function Topics(){
 const topics=blogTagCloud().map((t)=>({...t,...getBlogTopic(t.tag)}));
 const groups=[["task","Workflow tasks"],["situation","Operating situations"],["document","Document types"],["category","Business areas"],["topic","More topics"]];
 return <BlogLayout><Link href="/blog" className="text-sm underline">All knowledge articles</Link><h1 className="mt-6 text-4xl font-bold">Find the guide for your workflow.</h1><p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Start with the task you need to complete, the document you are working on or the situation that needs attention. Each collection links to complete guides with specific checks and related documentation.</p>{groups.map(([kind,label])=>{const items=topics.filter((t)=>t.kind===kind).sort((a,b)=>a.title.localeCompare(b.title));return items.length?<section key={kind} className="mt-12"><h2 className="text-2xl font-semibold">{label}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((t)=><article key={t.tag} className="rounded-xl border p-5"><h3 className="font-semibold"><Link href={`/blog/topics/${t.tag}`}>{t.title}</Link></h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{t.description}</p><p className="mt-3 text-xs">{t.count} articles</p></article>)}</div></section>:null;})}</BlogLayout>;
}
