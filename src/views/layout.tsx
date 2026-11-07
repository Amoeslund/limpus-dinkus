import type { Child } from 'hono/jsx';

export const CSS = `
:root{
  --bg:#121014; --panel:#1c1920; --panel2:#24202a; --line:#332e3a;
  --text:#e9e4dc; --muted:#9a929f; --gold:#d6ab69; --gold2:#f0cf8f;
  --bis:#e0803a; --upgrade:#a35ee8; --os:#4f8fe0; --ok:#5fbf6f; --bad:#d65b5b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,sans-serif}
a{color:inherit}
header{display:flex;align-items:center;gap:24px;padding:14px 24px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
.logo{font-family:Georgia,serif;font-size:22px;color:var(--gold);letter-spacing:.5px;text-decoration:none}
nav{display:flex;gap:4px;flex-wrap:wrap}
nav a{color:var(--muted);padding:8px 14px;border-radius:6px;text-decoration:none}
nav a.on,nav a:hover{background:var(--panel2);color:var(--text)}
.spacer{flex:1}
.login{color:var(--muted);font-size:13px;text-decoration:none}
.login:hover,.login.on{color:var(--text)}
main{padding:24px;max-width:1300px;margin:0 auto}
@media(max-width:600px){header{padding:12px 16px;gap:12px}main{padding:16px}}
h1{font-family:Georgia,serif;color:var(--gold2);font-weight:normal;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:20px;min-width:0}
.card h3{margin:0 0 12px;font-size:15px;color:var(--gold)}
table{border-collapse:collapse;width:100%}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
td.c,th.c{text-align:center}
.scroll{overflow-x:auto}
.alt{color:var(--muted);font-size:12px}
.y{color:var(--ok)} .n{color:#4a4450}
.num{font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600}
.p-bis{background:#3c2414;color:var(--bis)} .p-upgrade{background:#2c1c3e;color:var(--upgrade)} .p-os{background:#16263c;color:var(--os)}
.pug{background:var(--panel2);color:var(--muted);margin-left:8px;font-weight:400}
.item{color:#b373ff;text-decoration:none}
.item:hover{text-decoration:underline}
.grid2{display:grid;grid-template-columns:1.6fr 1fr;gap:20px}
.grid2>*{min-width:0}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.week{color:var(--gold);font-weight:600;padding-top:14px}
.loot tr.drop td.pl{white-space:normal}
@media(max-width:600px){
  .loot,.loot tbody{display:block}
  .loot tr.wk{display:block}
  .loot tr.wk td{display:block}
  .loot tr.drop{display:flex;flex-wrap:wrap;align-items:center;column-gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}
  .loot tr.drop td{border:0;padding:0 0 2px}
  .loot tr.drop td.it{flex:0 0 100%;white-space:normal;overflow-wrap:anywhere}
  .loot tr.drop td.pl{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
}
.bar{height:6px;background:var(--panel2);border-radius:3px;overflow:hidden;width:80px;display:inline-block;vertical-align:middle;margin-left:6px}
.bar i{display:block;height:100%;background:var(--gold)}
`;

export type NavInfo = { instances: { name: string; slug: string }[]; active?: string };

export const Layout = ({ title, nav, children, admin }: { title: string; nav: NavInfo; children?: Child; admin?: boolean }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <header>
        <a class="logo" href="/">Limpus Dinkus</a>
        <nav>
          <a href="/" class={nav.active === 'attendance' ? 'on' : ''}>Attendance</a>
          {nav.instances.map((i) => (
            <a href={`/raid/${i.slug}`} class={nav.active === i.slug ? 'on' : ''}>{i.name}</a>
          ))}
        </nav>
        <div class="spacer"></div>
        <a class={admin ? 'login on' : 'login'} href="/admin">Officer login</a>
      </header>
      <main>{children}</main>
    </body>
  </html>
);
