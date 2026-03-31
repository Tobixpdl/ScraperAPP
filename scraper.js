const { chromium } = require("playwright");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsearPrecio(precioStr) {
  if (!precioStr) return null;

  const limpio = String(precioStr)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, "")
    .trim();

  const num = parseFloat(limpio);
  return Number.isFinite(num) ? num : null;
}

function limpiarUrl(url) {
  if (!url) return null;

  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function coincideProducto(nombre, includes = [], excludes = []) {
  const n = normalizarTexto(nombre);

  const okIncludes =
    !includes.length || includes.every((x) => n.includes(normalizarTexto(x)));

  const okExcludes =
    !excludes.length || excludes.every((x) => !n.includes(normalizarTexto(x)));

  return okIncludes && okExcludes;
}

// ─────────────────────────────────────────────────────────────
// HardGamers
// ─────────────────────────────────────────────────────────────

async function scrapearHardGamers(page, item) {
  const {
    nombre,
    url,
    maxPages = 1,
    match = {},
  } = item;

  const resultados = [];

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    let pageUrl = url;

    if (pagina > 1) {
      const separador = url.includes("?") ? "&" : "?";
      pageUrl = `${url}${separador}page=${pagina}&limit=21`;
    }

    console.log(`🔎 HardGamers | ${nombre} | página ${pagina}`);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(2000);

    const productos = await page.evaluate(() => {
      const items = document.querySelectorAll(
        "article[itemtype='http://schema.org/Product']"
      );

      return Array.from(items).map((item) => {
        const nombre =
          item.querySelector("h3[itemprop='name']")?.innerText?.trim() ||
          item.querySelector(".product-title")?.innerText?.trim() ||
          "Sin nombre";

        let link = item.querySelector("a[itemprop='url']")?.href || null;

        const precioContent =
          item.querySelector("h2[itemprop='price']")?.getAttribute("content") ||
          null;

        const precioTexto = precioContent ? `$${precioContent}` : null;

        const tienda =
          item.querySelector("[itemprop='seller']")?.textContent?.trim() ||
          item.querySelector(".store, .seller, .product-store")?.textContent?.trim() ||
          "HardGamers";

        const imgEl =
          item.querySelector(".product-image img") ||
          item.querySelector("img[itemprop='image']");

        const imageUrl =
          imgEl?.getAttribute("src") ||
          imgEl?.getAttribute("data-src") ||
          null;

        return {
          nombre,
          precioTexto,
          link,
          tienda,
          imageUrl,
        };
      });
    });

    const filtrados = productos
      .map((p) => ({
        ...p,
        sitio: "HardGamers",
        link: limpiarUrl(p.link),
        precio: parsearPrecio(p.precioTexto),
      }))
      .filter((p) => p.nombre && p.precio);

    const matches = filtrados.filter((p) =>
      coincideProducto(
        p.nombre,
        match.includes || [],
        match.excludes || []
      )
    );

    resultados.push(...matches);

    if (productos.length < 21) {
      break;
    }
  }

  return resultados;
}

// ─────────────────────────────────────────────────────────────
// CompraGamer
// ─────────────────────────────────────────────────────────────

async function scrapearCompraGamer(page, item) {
  const {
    nombre,
    url,
    maxPages = 1,
    match = {},
  } = item;

  const resultados = [];

  console.log(`🔎 CompraGamer | ${nombre}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    console.log(`   página ${pagina}`);

    await page.waitForSelector("cgw-product-card", { timeout: 15000 });
    await sleep(2000);

    const productos = await page.evaluate(() => {
      const items = document.querySelectorAll("cgw-product-card");

      return Array.from(items).map((item) => {
        const linkEl = item.querySelector("a[href*='/producto/']");

        const nombre =
          linkEl?.getAttribute("title")?.trim() ||
          linkEl?.querySelector(".product-name, [class*='name']")?.innerText?.trim() ||
          item.querySelector("[class*='title'], [class*='name']")?.innerText?.trim() ||
          "Sin nombre";

        let link = linkEl?.href || null;

        const precioEl =
          item.querySelector(".txt_price") ||
          item.querySelector("[class*='txt_price']") ||
          item.querySelector("[class*='price']");

        const precioTexto = precioEl?.innerText?.trim() || null;

        const imgEl =
          item.querySelector("cgw-item-image img.ng-lazyloaded") ||
          item.querySelector("cgw-item-image img[src]") ||
          item.querySelector("img.ng-lazyloaded") ||
          item.querySelector("img[src*='compragamer']");

        const imageUrl =
          imgEl?.getAttribute("src") ||
          imgEl?.getAttribute("data-src") ||
          null;

        return {
          nombre,
          precioTexto,
          link,
          tienda: "CompraGamer",
          imageUrl,
        };
      });
    });

    const filtrados = productos
      .map((p) => ({
        ...p,
        sitio: "CompraGamer",
        link: limpiarUrl(p.link),
        precio: parsearPrecio(p.precioTexto),
      }))
      .filter((p) => p.nombre && p.precio);

    const matches = filtrados.filter((p) =>
      coincideProducto(
        p.nombre,
        match.includes || [],
        match.excludes || []
      )
    );

    resultados.push(...matches);

    if (pagina === maxPages) break;

    const nextButton = await page.$(
      "a[aria-label='Siguiente'], button[aria-label='Siguiente'], .pagination__next:not([disabled]), [class*='pagination'] a[rel='next']"
    );

    if (!nextButton) break;

    await nextButton.click();
    await page.waitForLoadState("networkidle");
  }

  return resultados;
}

// ─────────────────────────────────────────────────────────────
// General
// ─────────────────────────────────────────────────────────────

function elegirMejorResultado(resultados) {
  if (!resultados.length) return null;

  const ordenados = [...resultados].sort((a, b) => a.precio - b.precio);
  return ordenados[0];
}

async function scrapearWatchlist(watchlist) {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    locale: "es-AR",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  const salida = [];

  try {
    for (const item of watchlist) {
      try {
        let resultados = [];

        if (item.site === "hardgamers") {
          resultados = await scrapearHardGamers(page, item);
        } else if (item.site === "compragamer") {
          resultados = await scrapearCompraGamer(page, item);
        } else {
          console.warn(`⚠️ Sitio no soportado: ${item.site}`);
          salida.push({
            ...item,
            found: false,
            error: `Sitio no soportado: ${item.site}`,
          });
          continue;
        }

        const mejor = elegirMejorResultado(resultados);

        if (!mejor) {
          salida.push({
            ...item,
            found: false,
            error: "No se encontraron productos que coincidan",
          });
          continue;
        }

        salida.push({
          ...item,
          found: true,
          productName: mejor.nombre,
          price: mejor.precio,
          url: mejor.link,
          imageUrl: mejor.imageUrl || null,
          store: mejor.tienda || mejor.sitio || item.site,
          source: item.site,
          checkedAt: new Date().toISOString(),
          allMatches: resultados
            .sort((a, b) => a.precio - b.precio)
            .slice(0, 5)
            .map((r) => ({
              nombre: r.nombre,
              precio: r.precio,
              url: r.link,
              tienda: r.tienda || r.sitio || item.site,
            })),
        });
      } catch (err) {
        console.error(`❌ Error en ${item.nombre}: ${err.message}`);

        salida.push({
          ...item,
          found: false,
          error: err.message,
        });
      }
    }

    return salida;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapearWatchlist,
};