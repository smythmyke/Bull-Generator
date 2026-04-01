// Content script for patents.google.com

console.log('[Patent Search] Content script loaded on:', window.location.href);

interface PatentResult {
  title: string;
  patentId: string;
  patentNumber: string;
  inventor: string;
  assignee: string;
  dates: string;
  abstract: string;
  countries: string[];
  pdfUrl: string;
}

interface DeepPatentResult extends PatentResult {
  fullAbstract: string;
  cpcCodes: string[];
  firstClaim: string;
}

function scrapePatentResults(limit: number): PatentResult[] {
  const items = document.querySelectorAll('search-result-item');
  console.log(`[Patent Search] Found ${items.length} search-result-item elements`);

  const patentResults: PatentResult[] = [];
  const nplResults: PatentResult[] = [];

  for (let i = 0; i < Math.min(items.length, limit); i++) {
    const item = items[i];
    try {
      const stateModifier = item.querySelector('state-modifier.result-title');
      const dataResult = stateModifier?.getAttribute('data-result') || '';

      // Detect NPL items embedded in search-result-item wrappers
      const isNPL = dataResult.startsWith('scholar/');

      if (isNPL) {
        // NPL item in search listing
        const titleEl = item.querySelector('h3 raw-html span#htmlContent');
        const title = titleEl?.textContent?.trim() || '';
        const patentId = dataResult.replace('/en', '');

        const flexContainer = item.querySelector('.abstract .flex > .layout > .flex');
        const abstractEl = flexContainer?.querySelector(':scope > raw-html span#htmlContent');
        const abstract = abstractEl?.textContent?.trim() || '';

        const metadataEl = item.querySelector('h4.metadata');
        const bulletSpans = metadataEl?.querySelectorAll(':scope > span > span.bullet-before') || [];
        let inventor = '';
        bulletSpans.forEach((span) => {
          const rawHtml = span.querySelector('raw-html span#htmlContent');
          if (rawHtml && !inventor) {
            inventor = rawHtml.textContent?.trim() || '';
          }
        });

        const datesEl = item.querySelector('h4.dates');
        const dates = datesEl?.textContent?.trim() || '';

        // NPL items may have an external link instead of PDF
        const pdfLink = item.querySelector('a.pdfLink') as HTMLAnchorElement;
        const pdfUrl = pdfLink?.href || '';

        // Extract DOI from URL if available
        let doi = '';
        if (pdfUrl) {
          const doiParam = pdfUrl.match(/identifierValue=(10\.\d{4,}[^&]*)/);
          if (doiParam) doi = decodeURIComponent(doiParam[1]);
          if (!doi) {
            const doiPath = pdfUrl.match(/(?:doi\.org\/|\/doi\/)(10\.\d{4,}\/[^\s?&#]+)/);
            if (doiPath) doi = doiPath[1];
          }
        }

        if (title) {
          console.log(`[Patent Search] Found NPL in search listing: "${title.substring(0, 50)}..." id=${patentId}`);
          nplResults.push({
            title,
            patentId,
            patentNumber: `NPL: ${title.substring(0, 40)}${title.length > 40 ? '...' : ''}`,
            inventor,
            assignee: '',
            dates,
            abstract,
            countries: ['NPL'],
            pdfUrl,
            ...(doi ? { doi } : {}),
          } as PatentResult);
        }
        continue;
      }

      // Regular patent item
      const titleEl = item.querySelector('h3 raw-html span#htmlContent');
      const title = titleEl?.textContent?.trim() || '';
      const patentId = dataResult.replace('patent/', '').replace('/en', '');

      // Skip items with no data-result at all (unknown type)
      if (!dataResult) {
        console.log(`[Patent Search] Skipping result ${i}: no data-result attribute`);
        continue;
      }

      const pdfSpan = item.querySelector('.pdfLink span[data-proto="OPEN_PATENT_PDF"]');
      const patentNumber = pdfSpan?.textContent?.trim() || patentId;

      const pdfLink = item.querySelector('a.pdfLink') as HTMLAnchorElement;
      const pdfUrl = pdfLink?.href || '';

      const metadataEl = item.querySelector('h4.metadata');
      const bulletSpans = metadataEl?.querySelectorAll(':scope > span > span.bullet-before') || [];
      let inventor = '';
      let assignee = '';
      let bulletIndex = 0;
      bulletSpans.forEach((span) => {
        const rawHtml = span.querySelector('raw-html span#htmlContent');
        if (rawHtml) {
          const text = rawHtml.textContent?.trim() || '';
          if (bulletIndex === 0 && !text.match(/^[A-Z]{2}\d/)) {
            inventor = text;
            bulletIndex++;
          } else if (bulletIndex === 1) {
            assignee = text;
            bulletIndex++;
          }
        }
      });

      const datesEl = item.querySelector('h4.dates');
      const dates = datesEl?.textContent?.trim() || '';

      const flexContainer = item.querySelector('.abstract .flex > .layout > .flex');
      const abstractEl = flexContainer?.querySelector(':scope > raw-html span#htmlContent');
      const abstract = abstractEl?.textContent?.trim() || '';

      const countrySpans = metadataEl?.querySelectorAll('span.active') || [];
      const countries: string[] = [];
      countrySpans.forEach((span) => {
        const cc = span.textContent?.trim();
        if (cc) countries.push(cc);
      });

      if (title || patentNumber) {
        patentResults.push({ title, patentId, patentNumber, inventor, assignee, dates, abstract, countries, pdfUrl });
      }
    } catch (err) {
      console.error(`[Patent Search] Error scraping result ${i}:`, err);
    }
  }

  console.log(`[Patent Search] From search-result-items: ${patentResults.length} patents, ${nplResults.length} NPL`);
  return [...patentResults, ...nplResults];
}

function scrapeScholarResults(limit: number): PatentResult[] {
  const items = document.querySelectorAll('scholar-result');
  console.log(`[Patent Search] Found ${items.length} scholar result items`);

  const results: PatentResult[] = [];

  for (let i = 0; i < Math.min(items.length, limit); i++) {
    const item = items[i];
    try {
      // Title from h1#title
      const titleEl = item.querySelector('h1#title');
      const title = titleEl?.textContent?.trim() || '';

      // Scholar ID from state-modifier with QUERY_SIMILAR_DOCUMENTS action
      const similarModifier = item.querySelector('state-modifier[data-id]');
      const scholarId = similarModifier?.getAttribute('data-id') || '';
      const patentId = scholarId || `scholar-${i}-${Date.now()}`;

      // Snippet text from section#abstract patent-text section#text
      const snippetEl = item.querySelector('section#abstract patent-text section#text');
      const abstract = snippetEl?.textContent?.trim() || '';

      // Author from knowledge-card dl.important-people
      const authorModifier = item.querySelector('dl.important-people state-modifier[data-inventor]');
      const inventor = authorModifier?.getAttribute('data-inventor') || '';

      // Publication year from knowledge-card dl.key-dates
      const yearModifier = item.querySelector('dl.key-dates state-modifier[data-before]');
      const yearRaw = yearModifier?.getAttribute('data-before') || '';
      // Convert YYYYMMDD to "Publication YYYY"
      const year = yearRaw ? yearRaw.substring(0, 4) : '';
      const dates = year ? `Publication ${year}` : '';

      // Knowledge card header (e.g., "Pearsall, 2016")
      const headerEl = item.querySelector('section.knowledge-card header h2');
      const assignee = headerEl?.textContent?.trim() || '';

      // External link (main-link a)
      const mainLink = item.querySelector('div.main-link a') as HTMLAnchorElement;
      const pdfUrl = mainLink?.href || '';

      // Try to extract DOI from URL
      let doi = '';
      if (pdfUrl) {
        // Taylor & Francis: identifierValue=10.4324/...
        const doiParam = pdfUrl.match(/identifierValue=(10\.\d{4,}[^&]*)/);
        if (doiParam) {
          doi = decodeURIComponent(doiParam[1]);
        }
        // Generic doi.org or /doi/ pattern
        if (!doi) {
          const doiPath = pdfUrl.match(/(?:doi\.org\/|\/doi\/)(10\.\d{4,}\/[^\s?&#]+)/);
          if (doiPath) doi = doiPath[1];
        }
      }

      if (title) {
        results.push({
          title,
          patentId,
          patentNumber: `NPL: ${title.substring(0, 40)}${title.length > 40 ? '...' : ''}`,
          inventor,
          assignee,
          dates,
          abstract,
          countries: ['NPL'],
          pdfUrl,
          ...(doi ? { doi } : {}),
        } as PatentResult);
      }
    } catch (err) {
      console.error(`[Patent Search] Error scraping scholar result ${i}:`, err);
    }
  }

  return results;
}

function detectGoogleError(): { isError: boolean; reason?: string } {
  // Check for error indicators in the page
  const title = document.title || '';
  if (/503|500|error|unavailable/i.test(title)) {
    return { isError: true, reason: `Page title indicates error: ${title}` };
  }

  // Check for Google's "no results" message (legitimate zero results)
  const bodyText = document.body?.innerText || '';
  if (/no results found|did not match any documents|no patents found/i.test(bodyText)) {
    return { isError: false }; // Legitimate no-results, not an error
  }

  // Check for error/unavailable text in the page body
  if (/service unavailable|server error|unusual traffic|too many requests/i.test(bodyText)) {
    return { isError: true, reason: 'Google Patents returned an error page' };
  }

  return { isError: false };
}

function scrapeResults(limit: number = 35): PatentResult[] {
  const patentResults = scrapePatentResults(limit);
  const scholarResults = scrapeScholarResults(limit);
  const combined = [...patentResults, ...scholarResults].slice(0, limit);
  console.log(`[Patent Search] Scraped ${combined.length} results (${patentResults.length} patents, ${scholarResults.length} scholar)`);
  return combined;
}

async function deepScrapePatent(patentId: string): Promise<{ fullAbstract: string; cpcCodes: string[]; firstClaim: string }> {
  // Scholar/NPL results can't be deep-scraped like patents
  if (patentId.startsWith('scholar/') || patentId.startsWith('scholar-')) {
    console.log(`[Patent Search] Skipping deep scrape for scholar result: ${patentId}`);
    return { fullAbstract: '', cpcCodes: [], firstClaim: '' };
  }

  const url = `https://patents.google.com/patent/${patentId}/en`;
  console.log(`[Patent Search] Deep scraping: ${url}`);

  try {
    const response = await fetch(url);
    const html = await response.text();

    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Full abstract: <abstract> or <div class="abstract"> or section with abstract
    let fullAbstract = '';
    const abstractSection = doc.querySelector('section[itemprop="abstract"] div.abstract');
    if (abstractSection) {
      fullAbstract = abstractSection.textContent?.trim() || '';
    } else {
      // Fallback: look for abstract in other locations
      const abstractEl = doc.querySelector('abstract') || doc.querySelector('.abstract');
      fullAbstract = abstractEl?.textContent?.trim() || '';
    }

    // CPC codes: typically in classification sections
    const cpcCodes: string[] = [];
    const cpcElements = doc.querySelectorAll('span[itemprop="Code"]');
    cpcElements.forEach((el) => {
      const code = el.textContent?.trim();
      if (code && code.match(/^[A-H]\d/)) {
        cpcCodes.push(code);
      }
    });
    // Fallback: look for classification-tree or concept tags
    if (cpcCodes.length === 0) {
      const classEls = doc.querySelectorAll('classification-tree span.code, .classification-cpc span');
      classEls.forEach((el) => {
        const code = el.textContent?.trim();
        if (code && code.match(/^[A-H]\d/)) {
          cpcCodes.push(code);
        }
      });
    }

    // First independent claim: typically claim-text in claims section
    let firstClaim = '';
    const claimElements = doc.querySelectorAll('div.claim-text, claim-text');
    if (claimElements.length > 0) {
      firstClaim = claimElements[0].textContent?.trim() || '';
      // Limit claim length to avoid huge payloads
      if (firstClaim.length > 2000) {
        firstClaim = firstClaim.substring(0, 2000) + '...';
      }
    }

    return { fullAbstract, cpcCodes, firstClaim };
  } catch (err) {
    console.error(`[Patent Search] Error deep scraping ${patentId}:`, err);
    return { fullAbstract: '', cpcCodes: [], firstClaim: '' };
  }
}

async function deepScrapeAll(patents: PatentResult[]): Promise<DeepPatentResult[]> {
  const results: DeepPatentResult[] = [];

  // Process in parallel batches of 5 to avoid overwhelming the browser
  const batchSize = 10;
  for (let i = 0; i < patents.length; i += batchSize) {
    const batch = patents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (patent) => {
        const deep = await deepScrapePatent(patent.patentId);
        return { ...patent, ...deep };
      })
    );
    results.push(...batchResults);
    console.log(`[Patent Search] Deep scraped ${results.length}/${patents.length}`);
  }

  return results;
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'ok', url: window.location.href });
    return;
  }

  if (message.type === 'ENSURE_SEARCH_CONFIG') {
    try {
      // Ensure #patentIcon is active (include patents)
      const patentIcon = document.querySelector('#patentIcon') as HTMLElement;
      if (patentIcon && !patentIcon.hasAttribute('active')) {
        patentIcon.click();
        console.log('[Patent Search] Activated patent icon');
      }

      // Optionally toggle non-patent literature
      if (message.includeNPL) {
        // Landing page has paper-checkbox#includeNPL with aria-checked attribute
        const nplCheckbox = document.querySelector('paper-checkbox#includeNPL') as HTMLElement;
        if (nplCheckbox) {
          const isChecked = nplCheckbox.getAttribute('aria-checked') === 'true';
          if (!isChecked) {
            nplCheckbox.click();
            console.log('[Patent Search] Checked includeNPL paper-checkbox');
          } else {
            console.log('[Patent Search] includeNPL paper-checkbox already checked');
          }
        } else {
          // Search results page has iron-icon#nplIcon with active attribute
          const nplIcon = document.querySelector('#nplIcon') as HTMLElement;
          if (nplIcon && !nplIcon.hasAttribute('active')) {
            nplIcon.click();
            console.log('[Patent Search] Activated NPL icon');
          }
        }
      }

      sendResponse({ status: 'ok' });
    } catch (err) {
      sendResponse({ status: 'error', error: String(err) });
    }
    return;
  }

  if (message.type === 'SEARCH_PATENTS') {
    const query = message.query as string;
    console.log(`[Patent Search] SEARCH_PATENTS: query="${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"`);
    console.log(`[Patent Search] SEARCH_PATENTS: current URL=${window.location.href}`);

    try {
      const searchInput = document.querySelector('#searchInput') as HTMLInputElement;
      if (!searchInput) {
        console.error('[Patent Search] SEARCH_PATENTS: #searchInput NOT FOUND on page');
        sendResponse({ status: 'error', error: 'Search input not found on this page' });
        return;
      }
      console.log('[Patent Search] SEARCH_PATENTS: found #searchInput');

      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(searchInput, query);
        console.log('[Patent Search] SEARCH_PATENTS: set value via native setter');
      } else {
        searchInput.value = query;
        console.log('[Patent Search] SEARCH_PATENTS: set value via direct assignment');
      }

      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[Patent Search] SEARCH_PATENTS: dispatched input+change events');

      setTimeout(() => {
        const searchButton = document.querySelector('#searchButton') as HTMLElement;
        if (searchButton) {
          console.log('[Patent Search] SEARCH_PATENTS: clicking #searchButton');
          searchButton.click();
          sendResponse({ status: 'ok', searched: true, query, method: 'button' });
        } else {
          const encoded = encodeURIComponent(query);
          const navUrl = `https://patents.google.com/?q=${encoded}&num=100`;
          console.log(`[Patent Search] SEARCH_PATENTS: no #searchButton, navigating to ${navUrl.substring(0, 100)}...`);
          window.location.href = navUrl;
          sendResponse({ status: 'ok', searched: true, query, method: 'navigation' });
        }
      }, 50);

    } catch (err) {
      console.error('[Patent Search] SEARCH_PATENTS: EXCEPTION:', err);
      sendResponse({ status: 'error', error: String(err) });
    }

    return true;
  }

  if (message.type === 'SCRAPE_RESULTS') {
    const limit = message.limit || 15;
    console.log(`[Patent Search] SCRAPE_RESULTS: limit=${limit}, url=${window.location.href}`);
    try {
      const results = scrapeResults(limit);
      console.log(`[Patent Search] SCRAPE_RESULTS: returning ${results.length} results`);
      if (results.length === 0) {
        const errorCheck = detectGoogleError();
        if (errorCheck.isError) {
          console.warn(`[Patent Search] SCRAPE_RESULTS: Google error detected: ${errorCheck.reason}`);
          sendResponse({ status: 'google-unavailable', reason: errorCheck.reason, results: [], count: 0 });
          return;
        }
        // Check for explicit "no results found" in DOM
        const bodyText = document.body?.innerText || '';
        if (/no results found/i.test(bodyText)) {
          console.log('[Patent Search] SCRAPE_RESULTS: "No results found" detected in DOM');
          sendResponse({ status: 'ok', results: [], count: 0, noResults: true });
          return;
        }
      }
      sendResponse({ status: 'ok', results, count: results.length });
    } catch (err) {
      console.error('[Patent Search] SCRAPE_RESULTS: EXCEPTION:', err);
      sendResponse({ status: 'error', error: String(err) });
    }
    return;
  }

  if (message.type === 'DEEP_SCRAPE') {
    const patents = message.patents as PatentResult[];
    console.log(`[Patent Search] Deep scrape request for ${patents.length} patents`);

    deepScrapeAll(patents)
      .then((results) => {
        console.log(`[Patent Search] Deep scrape complete: ${results.length} patents enriched`);
        sendResponse({ status: 'ok', results });
      })
      .catch((err) => {
        console.error('[Patent Search] Deep scrape error:', err);
        sendResponse({ status: 'error', error: String(err) });
      });

    return true; // Keep channel open for async
  }
});

console.log('[Patent Search] Message listener registered');
