/// <reference path="../../localtypings/mscc.d.ts" />

namespace pxt {
    type Map<T> = {[index: string]: T};

    interface CookieBannerInfo {
        /* Does the banner need to be shown? */
        IsConsentRequired: boolean;

        /* Name of the cookie, usually MSCC */
        CookieName: string;

        /* HTML for the banner to be embedded into the page */
        Markup: string;

        /* Scripts to be loaded in the page for the banner */
        Js: string[];

        /* CSS files to be loaded in the page for the banner*/
        Css: string[];

        /* The minimum date for which consent is considered valid (any consent given before this date does not count) */
        MinimumConsentDate: string;

        /* Error message from the server, if present */
        Error?: string;
    }

    interface HttpResponse {
        status: number;
        body: string;
    }

    interface Callback<T> {
        (err?: any, res?: T): void;
    }

    const eventBufferSizeLimit = 20;
    const queues: TelemetryQueue<any, any, any>[] = [];

    let analyticsLoaded = false;

    class TelemetryQueue<A, B, C> {
        private q: [A, B, C][] = [];
        constructor (private log: (a?: A, b?: B, c?: C) => void) {
            queues.push(this);
        }

        public track(a: A, b: B, c: C) {
            if (analyticsLoaded) {
                this.log(a, b, c);
            }
            else {
                this.q.push([a, b, c]);
                if (this.q.length > eventBufferSizeLimit) this.q.shift();
            }
        }

        public flush() {
            while (this.q.length) {
                const [a, b, c] = this.q.shift();
                this.log(a, b, c);
            }
        }
    }

    let eventLogger: TelemetryQueue<string, Map<string>, Map<number>>;
    let exceptionLogger: TelemetryQueue<any, string, Map<string>>;

    export function initAnalyticsAsync() {
        getCookieBannerAsync(document.domain, detectLocale(), (bannerErr, info) => {
            if (bannerErr || info.Error) {
                // Start app insights, just don't drop any cookies
                // initializeAppInsights(false);
                // return;
                info = { "IsConsentRequired": true, "CookieName": "MSCC", "Markup": "<div id='msccBanner' dir='ltr' data-site-name='uhf-makecode' data-mscc-version='0.4.0' data-nver='aspnet-2.0.7' data-sver='0.1.2' class='cc-banner' role='alert'><div class='cc-container'><svg class='cc-icon cc-v-center' x='0px' y='0px' viewBox='0 0 44 44' height='30px' fill='none' stroke='currentColor'><circle cx='22' cy='22' r='20' stroke-width='2'></circle><line x1='22' x2='22' y1='18' y2='33' stroke-width='3'></line><line x1='22' x2='22' y1='12' y2='15' stroke-width='3'></line></svg> <span class='cc-v-center cc-text'>This site uses cookies for analytics, personalized content and ads. By continuing to browse this site, you agree to this use.</span> <a href='https://go.microsoft.com/fwlink/?linkid=845480' aria-label='Learn more about Microsoft&#39;s Cookie Policy' id='msccLearnMore' class='cc-link cc-v-center cc-float-right' data-mscc-ic='false'>Learn more</a></div></div>", "Css": ["https://uhf.microsoft.com/mscc/statics/mscc-0.4.0.min.css"], "Js": ["https://uhf.microsoft.com/mscc/statics/mscc-0.4.0.min.js"], "MinimumConsentDate": "2019-04-01T00:00:00", "Error": null, "lastUpdate": 1517615910 } as any;
            }

            // Clear the cookies if the consent is too old, mscc won't do it automatically
            if (isConsentExpired(info.CookieName, info.MinimumConsentDate)) {
                const definitelyThePast = new Date(0).toUTCString();
                document.cookie = `ai_user=; expires=${definitelyThePast}`;
                document.cookie = `ai_session=; expires=${definitelyThePast}`;
                document.cookie = `${info.CookieName}=0; expires=${definitelyThePast}`;
            }

            let bannerDiv = document.getElementById("cookiebanner");
            if (!bannerDiv) {
                bannerDiv = document.createElement("div");
                document.body.insertBefore(bannerDiv, document.body.firstChild);
            }

            // The markup is trusted because it's from our backend, so it shouldn't need to be scrubbed
            bannerDiv.innerHTML = info.Markup;

            if (info.Css && info.Css.length) {
                info.Css.forEach(injectStylesheet)
            }

            all(info.Js || [], injectScriptAsync, msccError => {
                initializeAppInsights(!msccError && typeof mscc !== "undefined" && mscc.hasConsent());
            });
        });
    }

    export function aiTrackEvent(id: string, data?: any, measures?: any) {
        if (!eventLogger) {
            eventLogger = new TelemetryQueue<string, Map<string>, Map<number>>((a, b, c) => (window as any).appInsights.trackEvent(a, b, c));
        }
        eventLogger.track(id, data, measures);
    }

    export function aiTrackException(err: any, kind?: string, props?: any) {
        if (!exceptionLogger) {
            exceptionLogger = new TelemetryQueue<any, string, Map<string>>((a, b, c) => (window as any).appInsights.trackException(a, b, c));
        }
        exceptionLogger.track(err, kind, props);
    }

    function detectLocale() {
        // Intentionally ignoring the default locale in the target settings and the language cookie
        // Warning: app.tsx overwrites the hash after reading the language so this needs
        // to be called before that happens
        const mlang = /(live)?lang=([a-z]{2,}(-[A-Z]+)?)/i.exec(window.location.href);
        return mlang ? mlang[2] : ((navigator as any).userLanguage || navigator.language);
    }

    function getCookieBannerAsync(domain: string, locale: string, cb: Callback<CookieBannerInfo>) {
        httpGetAsync(`https://makecode.com/api/mscc/${domain}/${locale}`, function(err, resp) {
            if (err) {
                cb(err);
                return;
            }

            if (resp.status === 200) {
                try {
                    const info = JSON.parse(resp.body);
                    cb(undefined, info as CookieBannerInfo);
                    return;
                }
                catch (e) {
                    cb(new Error("Bad response from server: " + resp.body))
                    return;
                }
            }
            cb(new Error("didn't get 200 response: " + resp.status + " " + resp.body));
        });
    }

    function isConsentExpired(cookieName: string, minimumConsentDate: string) {
        const minDate = Date.parse(minimumConsentDate);

        if (!isNaN(minDate)) {
            if (document && document.cookie) {
                const cookies = document.cookie.split(";");
                for (let cookie of cookies) {
                    cookie = cookie.trim();
                    if (cookie.indexOf("=") == cookieName.length && cookie.substr(0, cookieName.length) == cookieName) {
                        const value = parseInt(cookie.substr(cookieName.length + 1));
                        if (!isNaN(value)) {
                            // The cookie value is the consent date in seconds since the epoch
                            return value < Math.floor(minDate / 1e3);
                        }
                        return true;
                    }
                }
            }
        }

        return true;
    }

    function initializeAppInsights(includeCookie = false) {
        // loadAppInsights is defined in docfiles/tracking.html
        const loadAI = (window as any).loadAppInsights;
        if (loadAI) {
            loadAI(includeCookie);
            analyticsLoaded = true;
            queues.forEach(a => a.flush());
        }
    }

    function httpGetAsync(url: string, cb: Callback<HttpResponse>) {
        try {
            let client: XMLHttpRequest;
            let resolved = false
            client = new XMLHttpRequest();
            client.onreadystatechange = () => {
                if (resolved) return // Safari/iOS likes to call this thing more than once

                if (client.readyState == 4) {
                    resolved = true
                    let res: HttpResponse = {
                        status: client.status,
                        body: client.responseText
                    }
                    cb(undefined, res);
                }
            }

            client.open("GET", url);
            client.send();
        }
        catch (e) {
            cb(e);
        }
    }

    function injectStylesheet(href: string) {
        if (document.head) {
            const link = document.createElement("link");
            link.setAttribute("rel", "stylesheet");
            link.setAttribute("href", href);
            link.setAttribute("type", "text/css");
            document.head.appendChild(link);
        }
    }

    function injectScriptAsync(src: string, cb: Callback<void>) {
        let resolved = false;
        if (document.body) {
            const script = document.createElement("script");
            script.setAttribute("type", "text/javascript");
            script.onload = function (ev) {
                if (!resolved) {
                    cb();
                    resolved = true;
                }
            };
            script.onerror = function (err) {
                if (!resolved) {
                    cb(err);
                    resolved = true;
                }
            }
            document.body.appendChild(script);
            script.setAttribute("src", src);
        }
        else {
            throw new Error("Bad call to injectScriptAsync")
        }
    }

    // No promises, so here we are
    function all<T, U>(values: T[], func: (value: T, innerCb: Callback<U>) => void, cb: Callback<U[]>) {
        let index = 0;
        let res: U[] = [];

        let doNext = () => {
            if (index >= values.length) {
                cb(undefined, res);
            }
            else {
                func(values[index++], (err, val) => {
                    if (err) {
                        cb(err);
                    }
                    else {
                        res.push(val);
                        doNext();
                    }
                });
            }
        };

        doNext();
    }
}