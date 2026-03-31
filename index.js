const fs = require("fs");
const path = require("path");
const { scrapearWatchlist } = require("./scraper");
const { enviarMensajeTelegram } = require("./telegram");

const watchlistPath = path.join(__dirname, "watchlist.json");
const statePath = path.join(__dirname, "state.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function fmtPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";

  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function getEstadoTarget(price, targetPrice) {
  if (price < targetPrice) {
    return {
      emoji: "🔻",
      texto: "Debajo del target",
    };
  }

  if (price === targetPrice) {
    return {
      emoji: "🎯",
      texto: "En el target",
    };
  }

  return {
    emoji: "🔺",
    texto: "Sobre el target",
  };
}

function cortarTexto(texto, max = 90) {
  const t = String(texto ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3).trim() + "...";
}

function armarBloqueProducto(r, estado) {
  return [
    `🛒 ${cortarTexto(r.productName || r.nombre, 90)}`,
    `💸 Precio actual: ${fmtPrice(r.price)}`,
    `🎯 Precio objetivo: ${fmtPrice(r.targetPrice)}`,
    `${estado.emoji} ${estado.texto}`,
    `🏪 Tienda: ${r.store || "-"}`,
    `${r.url || ""}`,
    ``,
  ].join("\n");
}

(async () => {
  const watchlist = readJson(watchlistPath, []);
  const state = readJson(statePath, { alerts: {} });

  const resultados = await scrapearWatchlist(watchlist);

  const bloquesMensaje = [];
  const errores = [];

  for (const r of resultados) {
    if (!r.found) {
      console.log(`⚠️ ${r.nombre}: ${r.error}`);
      errores.push(`⚠️ ${r.nombre}: ${r.error}`);
      continue;
    }

    console.log(
      `✅ ${r.nombre}: ${fmtPrice(r.price)} | objetivo ${fmtPrice(r.targetPrice)}`
    );

    const prev = state.alerts[r.id];
    const soloAlBajar = r.mandarMensajeSoloAlBajar === true;

    const estaDebajo = r.price < r.targetPrice;
    const estaEnTarget = r.price === r.targetPrice;
    const cumple = estaDebajo || estaEnTarget;

    const estado = getEstadoTarget(r.price, r.targetPrice);

    let incluirEnMensaje = false;

    if (soloAlBajar) {
      const esNuevoAviso =
        !prev ||
        !prev.alerted ||
        prev.lastCondition !== "below_or_equal" ||
        r.price < (prev.lastAlertPrice ?? Infinity);

      if (cumple && esNuevoAviso) {
        incluirEnMensaje = true;
      }
    } else {
      incluirEnMensaje = true;
    }

    if (incluirEnMensaje) {
      bloquesMensaje.push(armarBloqueProducto(r, estado));
    }

    state.alerts[r.id] = {
      alerted: soloAlBajar ? cumple : false,
      lastAlertPrice:
        soloAlBajar && incluirEnMensaje ? r.price : (prev?.lastAlertPrice ?? null),
      lastSeenPrice: r.price,
      lastCheckedAt: r.checkedAt,
      lastCondition: cumple ? "below_or_equal" : "above",
    };
  }

  if (bloquesMensaje.length > 0 || errores.length > 0) {
    const partes = [];

    if (bloquesMensaje.length > 0) {
      partes.push("🔔 RESULTADOS WATCHLIST");
      partes.push("");
      partes.push(...bloquesMensaje);
    }

    if (errores.length > 0) {
      partes.push("");
      partes.push("⚠️ ERRORES");
      partes.push("");
      partes.push(...errores);
    }

    const mensaje = partes.join("\n");
    await enviarMensajeTelegram(mensaje);
  } else {
    console.log("ℹ️ No hubo nada para notificar.");
  }

  writeJson(statePath, state);
})();