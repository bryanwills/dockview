// Cookie-consent banner and analytics gate for the docs site.
//
// This mirrors the enterprise licensing app (src/components/consent-manager.tsx
// in the dockview-licencing repo) so both apps share one consent decision
// across dockview.dev. The consent cookie name (dv_cc), domain (dockview.dev),
// categories and revision must stay identical on both sides; otherwise a
// visitor would be asked once per app instead of once per domain.
//
// Google Analytics is hard-gated: gtag.js is not loaded until the visitor
// accepts the analytics category, and only in production, matching the shared
// privacy policy at /enterprise/privacy. This replaces the old fire-on-load
// gtag plugin that ran unconditionally in CI. The consent plugin itself
// initialises in every environment (the banner only auto-shows in production)
// so the footer "Cookie settings" control also works in local development.

import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

const GA_MEASUREMENT_ID = 'G-KXGC1C9ZHC';

let gaLoaded = false;
let analyticsAllowed = false;

// Inject gtag.js and initialise the GA4 property. Idempotent, so repeated
// consent callbacks are harmless.
function loadGoogleAnalytics() {
    if (gaLoaded) return;
    gaLoaded = true;

    window.dataLayer = window.dataLayer || [];
    // gtag.js recognises a command by the pushed value being an `arguments`
    // object; anything else, including a plain array, is treated as a
    // data-layer variable merge. A rest-parameter version therefore pushes
    // `['config', 'G-...']` as data and the config command never runs, so the
    // property receives nothing. Keep this a normal function that pushes
    // `arguments`, exactly as Google's snippet does.
    function gtag() {
        window.dataLayer.push(arguments);
    }
    window.gtag = gtag;

    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src =
        'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(script);
}

let started = false;

function initConsent() {
    import('vanilla-cookieconsent').then((CookieConsent) => {
        const host = window.location.hostname;
        // Share the decision across dockview.dev and its subdomains in prod;
        // fall back to a host-only cookie on localhost or preview hosts.
        const cookieDomain =
            host === 'dockview.dev' || host.endsWith('.dockview.dev')
                ? 'dockview.dev'
                : host;

        const syncAnalytics = () => {
            analyticsAllowed =
                CookieConsent.acceptedCategory('analytics') &&
                process.env.NODE_ENV === 'production';

            if (analyticsAllowed) {
                loadGoogleAnalytics();
            } else if (gaLoaded && typeof window.gtag === 'function') {
                // Consent was withdrawn after gtag.js was injected. The script
                // cannot be removed from the page, so tell it to stop using
                // storage; onRouteDidUpdate below stops reporting too.
                window.gtag('consent', 'update', {
                    analytics_storage: 'denied',
                });
            }
        };

        // Docusaurus (react-helmet) rewrites the <html> class on render and
        // strips cookieconsent's show--consent / show--preferences classes, so
        // the modal never becomes visible. Mirror those classes onto <body>,
        // which Docusaurus leaves alone. cookieconsent's own CSS keys off any
        // ancestor of #cc-main, so this restores visibility without any style
        // duplication.
        const showClassFor = (modalName) =>
            modalName === 'preferencesModal'
                ? 'show--preferences'
                : 'show--consent';
        const mirrorShow = ({ modalName }) =>
            document.body.classList.add(showClassFor(modalName));
        const mirrorHide = ({ modalName }) =>
            document.body.classList.remove(showClassFor(modalName));

        // cookieconsent binds [data-cc] triggers with per-element listeners at
        // init time, so the footer "Cookie settings" button loses its handler
        // after a Docusaurus client-side navigation recreates it. Delegate from
        // the document so whichever button is currently mounted keeps working.
        document.addEventListener('click', (event) => {
            const trigger = event.target?.closest?.(
                '[data-cc="show-preferencesModal"]'
            );
            if (trigger) {
                event.preventDefault();
                CookieConsent.showPreferences();
            }
        });

        return CookieConsent.run({
            // Only auto-show the banner in production. In dev the plugin still
            // initialises (so "Cookie settings" works) but stays silent.
            autoShow: process.env.NODE_ENV === 'production',
            guiOptions: {
                consentModal: { layout: 'box', position: 'bottom left' },
                preferencesModal: { layout: 'box' },
            },
            cookie: {
                name: 'dv_cc',
                domain: cookieDomain,
                expiresAfterDays: 182,
            },
            categories: {
                necessary: {
                    enabled: true,
                    readOnly: true,
                },
                analytics: {
                    enabled: false,
                    autoClear: {
                        cookies: [
                            { name: /^_ga/ }, // _ga and _ga_<container>
                            { name: '_gid' },
                            { name: '_gat' },
                        ],
                    },
                },
            },
            // Runs on first consent and on every load where analytics was
            // already accepted, then loads GA. Withdrawing fires onChange.
            onConsent: syncAnalytics,
            onChange: syncAnalytics,
            onModalShow: mirrorShow,
            onModalHide: mirrorHide,
            language: {
                default: 'en',
                translations: {
                    en: {
                        consentModal: {
                            title: 'We value your privacy',
                            description:
                                'We use strictly necessary cookies to run the site and to remember this choice. With your consent, we also use Google Analytics to measure how the site is used. See our <a href="/enterprise/privacy">privacy policy</a>.',
                            acceptAllBtn: 'Accept all',
                            acceptNecessaryBtn: 'Reject non-essential',
                            showPreferencesBtn: 'Manage preferences',
                        },
                        preferencesModal: {
                            title: 'Cookie preferences',
                            acceptAllBtn: 'Accept all',
                            acceptNecessaryBtn: 'Reject non-essential',
                            savePreferencesBtn: 'Save preferences',
                            closeIconLabel: 'Close',
                            sections: [
                                {
                                    title: 'Strictly necessary',
                                    description:
                                        'Required for the site to work, for example to remember your cookie choice. These cannot be switched off.',
                                    linkedCategory: 'necessary',
                                },
                                {
                                    title: 'Analytics',
                                    description:
                                        'Google Analytics helps us understand how visitors use the site so we can improve it. It is not loaded until you accept.',
                                    linkedCategory: 'analytics',
                                },
                                {
                                    title: 'More information',
                                    description:
                                        'For details on how we handle your data, see our <a href="/enterprise/privacy">privacy policy</a>.',
                                },
                            ],
                        },
                    },
                },
            },
        });
    }).catch((e) => {
        console.error('[consent] cookieconsent failed to run', e);
    });
}

// gtag.js reports a page_view only for the document it was loaded into.
// Docusaurus is a single page app, so every in-site navigation after that is
// invisible to GA unless we report it ourselves. @docusaurus/plugin-google-gtag
// used to do this; it went away when analytics moved behind the consent gate.
export function onRouteDidUpdate({ location, previousLocation }) {
    if (!analyticsAllowed || typeof window.gtag !== 'function') return;
    if (!previousLocation) return;

    // A hash-only change is an anchor jump within the same page, not a view.
    if (
        location.pathname === previousLocation.pathname &&
        location.search === previousLocation.search
    ) {
        return;
    }

    // Let react-helmet apply the new <title> before we read it.
    setTimeout(() => {
        window.gtag('event', 'page_view', {
            page_title: document.title,
            page_location: window.location.href,
            page_path: location.pathname + location.search,
        });
    }, 0);
}

if (ExecutionEnvironment.canUseDOM && !started) {
    started = true;
    // Defer a couple of frames so the banner is initialised against a settled
    // DOM rather than mid-render. Deliberately not `load`: that waits for every
    // sub-resource, and doc pages embed <CodeRunner> iframes, which delays the
    // banner and the first page_view by seconds on exactly the pages that carry
    // the most traffic. Hydration timing no longer matters here because the
    // modal classes are mirrored onto <body> and the preferences trigger is
    // delegated from the document.
    const start = () =>
        requestAnimationFrame(() => requestAnimationFrame(initConsent));
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}
