(()=>{var a={};a.id=440,a.ids=[440],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},7284:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>E,patchFetch:()=>D,routeModule:()=>z,serverHooks:()=>C,workAsyncStorage:()=>A,workUnitAsyncStorage:()=>B});var d={};c.r(d),c.d(d,{GET:()=>y});var e=c(95736),f=c(9117),g=c(4044),h=c(39326),i=c(32324),j=c(261),k=c(54290),l=c(85328),m=c(38928),n=c(46595),o=c(3421),p=c(17679),q=c(41681),r=c(63446),s=c(86439),t=c(51356),u=c(10641),v=c(63431),w=c(70673);function x(a,b,c=!1){return`
    <tr class="${c?"emphasis":""}">
      <td>${a}</td>
      <td>${b}</td>
    </tr>
  `}async function y(a){let{searchParams:b}=new URL(a.url),c=Number(b.get("year")??new Date().getFullYear()),d=Number.isInteger(c)&&c>=2020&&c<=2100?c:new Date().getFullYear(),e=await (0,v.tO)(d),f=e.settings?.business_owner_name||"Buchhaltung",g=e.kpis.tripDrivingTotal+e.kpis.tripTravelTotal,h=`
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Jahresreport ${d}</title>
        <style>
          @page {
            size: A4;
            margin: 18mm;
          }

          :root {
            --ink: #0f172a;
            --muted: #64748b;
            --line: #dbe3ef;
            --soft: #f1f5f9;
            --panel: #f8fafc;
            --accent: #14532d;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #ffffff;
            color: var(--ink);
            font-family:
              ui-sans-serif,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif;
            font-size: 13px;
            line-height: 1.45;
          }

          .page {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px;
          }

          .hero {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 24px;
            align-items: end;
            border-bottom: 2px solid var(--ink);
            padding-bottom: 22px;
            margin-bottom: 24px;
          }

          .eyebrow {
            margin: 0 0 8px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          h1 {
            margin: 0;
            font-size: 34px;
            line-height: 1.05;
            letter-spacing: -0.02em;
          }

          h2 {
            margin: 0 0 12px;
            font-size: 16px;
          }

          .meta {
            min-width: 220px;
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 14px;
            padding: 14px;
          }

          .meta div {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            padding: 5px 0;
          }

          .meta span:first-child,
          .label {
            color: var(--muted);
          }

          .summary {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin: 24px 0;
          }

          .tile {
            border: 1px solid var(--line);
            border-radius: 14px;
            background: var(--soft);
            padding: 14px;
            min-height: 94px;
          }

          .tile strong {
            display: block;
            margin-top: 8px;
            font-size: 20px;
            line-height: 1.15;
          }

          .tile.primary {
            background: #ecfdf3;
            border-color: #bbf7d0;
          }

          .tile.primary strong {
            color: var(--accent);
          }

          .section {
            margin-top: 26px;
          }

          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            overflow: hidden;
            border: 1px solid var(--line);
            border-radius: 14px;
          }

          th,
          td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid var(--line);
          }

          th {
            background: var(--ink);
            color: #ffffff;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          tr:last-child td {
            border-bottom: 0;
          }

          td:last-child,
          th:last-child {
            text-align: right;
            white-space: nowrap;
          }

          tr.emphasis td {
            background: #f8fafc;
            font-weight: 700;
          }

          .two-column {
            display: grid;
            grid-template-columns: 1.08fr 0.92fr;
            gap: 18px;
            align-items: start;
          }

          .footer {
            margin-top: 28px;
            padding-top: 14px;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: 11px;
          }

          @media print {
            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }

            .page {
              padding: 0;
            }

            .section,
            table,
            .summary {
              break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header class="hero">
            <div>
              <p class="eyebrow">Jahresabschluss</p>
              <h1>Jahresreport ${d}</h1>
            </div>
            <aside class="meta">
              <div><span>Name</span><strong>${(0,w.ZD)(f)}</strong></div>
              <div><span>W\xe4hrung</span><strong>${e.reportingCurrency}</strong></div>
              <div><span>Erstellt</span><strong>${function(a=new Date){return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"long",year:"numeric"}).format(a)}()}</strong></div>
            </aside>
          </header>

          <section class="summary">
            <div class="tile primary">
              <span class="label">Umsatz</span>
              <strong>${(0,w.vv)(e.kpis.paymentReceivedTotal,e.reportingCurrency)}</strong>
            </div>
            <div class="tile">
              <span class="label">Steuerlich relevante Kosten</span>
              <strong>${(0,w.vv)(e.kpis.deductibleCostTotal,e.reportingCurrency)}</strong>
            </div>
            <div class="tile primary">
              <span class="label">Steuerlich relevanter Betrag</span>
              <strong>${(0,w.vv)(e.kpis.taxRelevantProfit,e.reportingCurrency)}</strong>
            </div>
          </section>

          <section class="section two-column">
            <div>
              <h2>Zusammenfassung</h2>
              <table>
                <thead>
                  <tr><th>Position</th><th>Wert</th></tr>
                </thead>
                <tbody>
                  ${x("Rechnungssumme (nur Berichtsw\xe4hrung)",(0,w.vv)(e.kpis.incomeTotal,e.reportingCurrency))}
                  ${x("Eingegangene Einnahmen",(0,w.vv)(e.kpis.paymentReceivedTotal,e.reportingCurrency),!0)}
                  ${x("Aktuell offene Rechnungen CHF",(0,w.vv)(e.kpis.openInvoiceAmounts.CHF,"CHF"))}
                  ${x("Aktuell offene Rechnungen EUR",(0,w.vv)(e.kpis.openInvoiceAmounts.EUR,"EUR"))}
                  ${x("Geb\xfchren",(0,w.vv)(e.kpis.feeTotal,e.reportingCurrency))}
                  ${x("Fahrt-, Reise- und Verpflegungskosten",(0,w.vv)(g,e.reportingCurrency))}
                  ${x("Ausgaben",(0,w.vv)(e.kpis.deductibleExpensesTotal+e.kpis.depreciationTotal,e.reportingCurrency))}
                  ${x("Steuerlich relevante Kosten",(0,w.vv)(e.kpis.deductibleCostTotal,e.reportingCurrency),!0)}
                  ${x("Steuerlich relevanter Betrag",(0,w.vv)(e.kpis.taxRelevantProfit,e.reportingCurrency),!0)}
                </tbody>
              </table>
            </div>

            <div>
              <h2>Kostenaufschl\xfcsselung</h2>
              <table>
                <thead>
                  <tr><th>Kategorie</th><th>Wert</th></tr>
                </thead>
                <tbody>
                  ${x("Ausgaben",(0,w.vv)(e.kpis.deductibleExpensesTotal,e.reportingCurrency))}
                  ${x("Zus\xe4tzlich zum Nettozahlungseingang abzuziehende Geb\xfchren",(0,w.vv)(e.kpis.deductibleFeeTotal,e.reportingCurrency))}
                  ${x("Fahrtkosten",(0,w.vv)(e.kpis.tripDrivingTotal,e.reportingCurrency))}
                  ${x("Reise & Verpflegung",(0,w.vv)(e.kpis.tripTravelTotal,e.reportingCurrency))}
                  ${x("Abschreibungen",(0,w.vv)(e.kpis.depreciationTotal,e.reportingCurrency))}
                </tbody>
              </table>
            </div>
          </section>

          <section class="section">
            <h2>Monats\xfcbersicht</h2>
            <table>
              <thead>
                <tr>
                  <th>Monat</th>
                  <th>Umsatz</th>
                  <th>Kundenbeteiligung</th>
                  <th>Kosten</th>
                  <th>Resultat</th>
                </tr>
              </thead>
              <tbody>
                ${e.monthly.map(a=>`
                      <tr>
                        <td>${a.month}</td>
                        <td>${(0,w.vv)(a.incomes,e.reportingCurrency)}</td>
                        <td>${(0,w.vv)(a.clientShare,e.reportingCurrency)}</td>
                        <td>${(0,w.vv)(a.costs,e.reportingCurrency)}</td>
                        <td>${(0,w.vv)(a.result,e.reportingCurrency)}</td>
                      </tr>
                    `).join("")}
              </tbody>
            </table>
          </section>

          <p class="footer">
            Dieser Report ist eine druckbare \xdcbersicht aus den erfassten Buchhaltungsdaten.
            Die fachliche Pr\xfcfung erfolgt bei Bedarf separat.
          </p>
        </main>
      </body>
    </html>
  `;return new u.NextResponse(h,{headers:{"Content-Type":"text/html; charset=utf-8"}})}let z=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/report/route",pathname:"/api/report",filename:"route",bundlePath:"app/api/report/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"C:\\Users\\Anwender\\Dropbox\\Codex Projects\\buchhaltung-app\\src\\app\\api\\report\\route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:A,workUnitAsyncStorage:B,serverHooks:C}=z;function D(){return(0,g.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:B})}async function E(a,b,c){var d;let e="/api/report/route";"/index"===e&&(e="/");let g=await z.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:x,prerenderManifest:y,routerServerContext:A,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(y.dynamicRoutes[E]||y.routes[D]);if(F&&!x){let a=!!y.routes[D],b=y.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||z.isDev||x||(G="/index"===(G=D)?"/":G);let H=!0===z.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:y,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>z.onRequestError(a,b,d,A)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>z.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&B&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await z.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})},A),b}},l=await z.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",B?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),x&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await z.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},10846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},19121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},29294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},43740:(a,b)=>{"use strict";Object.defineProperty(b,"__esModule",{value:!0}),Object.defineProperty(b,"isPostpone",{enumerable:!0,get:function(){return d}});let c=Symbol.for("react.postpone");function d(a){return"object"==typeof a&&null!==a&&a.$$typeof===c}},44870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},61981:(a,b,c)=>{"use strict";Object.defineProperty(b,"__esModule",{value:!0}),Object.defineProperty(b,"isNextRouterError",{enumerable:!0,get:function(){return f}});let d=c(98541),e=c(92781);function f(a){return(0,e.isRedirectError)(a)||(0,d.isHTTPAccessFallbackError)(a)}("function"==typeof b.default||"object"==typeof b.default&&null!==b.default)&&void 0===b.default.__esModule&&(Object.defineProperty(b.default,"__esModule",{value:!0}),Object.assign(b.default,b),a.exports=b.default)},63033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},78335:()=>{},86439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},92781:(a,b,c)=>{"use strict";Object.defineProperty(b,"__esModule",{value:!0}),!function(a,b){for(var c in b)Object.defineProperty(a,c,{enumerable:!0,get:b[c]})}(b,{REDIRECT_ERROR_CODE:function(){return e},RedirectType:function(){return f},isRedirectError:function(){return g}});let d=c(91203),e="NEXT_REDIRECT";var f=function(a){return a.push="push",a.replace="replace",a}({});function g(a){if("object"!=typeof a||null===a||!("digest"in a)||"string"!=typeof a.digest)return!1;let b=a.digest.split(";"),[c,f]=b,g=b.slice(2,-2).join(";"),h=Number(b.at(-2));return c===e&&("replace"===f||"push"===f)&&"string"==typeof g&&!isNaN(h)&&h in d.RedirectStatusCode}("function"==typeof b.default||"object"==typeof b.default&&null!==b.default)&&void 0===b.default.__esModule&&(Object.defineProperty(b.default,"__esModule",{value:!0}),Object.assign(b.default,b),a.exports=b.default)},96487:()=>{},98541:(a,b)=>{"use strict";Object.defineProperty(b,"__esModule",{value:!0}),!function(a,b){for(var c in b)Object.defineProperty(a,c,{enumerable:!0,get:b[c]})}(b,{HTTPAccessErrorStatus:function(){return c},HTTP_ERROR_FALLBACK_ERROR_CODE:function(){return e},getAccessFallbackErrorTypeByStatus:function(){return h},getAccessFallbackHTTPStatus:function(){return g},isHTTPAccessFallbackError:function(){return f}});let c={NOT_FOUND:404,FORBIDDEN:403,UNAUTHORIZED:401},d=new Set(Object.values(c)),e="NEXT_HTTP_ERROR_FALLBACK";function f(a){if("object"!=typeof a||null===a||!("digest"in a)||"string"!=typeof a.digest)return!1;let[b,c]=a.digest.split(";");return b===e&&d.has(Number(c))}function g(a){return Number(a.digest.split(";")[1])}function h(a){switch(a){case 401:return"unauthorized";case 403:return"forbidden";case 404:return"not-found";default:return}}("function"==typeof b.default||"object"==typeof b.default&&null!==b.default)&&void 0===b.default.__esModule&&(Object.defineProperty(b.default,"__esModule",{value:!0}),Object.assign(b.default,b),a.exports=b.default)}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[543,63,825,930,812],()=>b(b.s=7284));module.exports=c})();