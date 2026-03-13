const SCALE = 100;

const piecesBody = document.getElementById("pieces-body");
const addPieceButton = document.getElementById("add-piece");
const form = document.getElementById("optimizer-form");
const resultsSection = document.getElementById("results");
const recommendationCard = document.getElementById("recommendation-card");
const horizontalCard = document.getElementById("horizontal-card");
const verticalCard = document.getElementById("vertical-card");

bootstrapRows();
runAnalysis();

addPieceButton.addEventListener("click", () => addPieceRow());
piecesBody.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-piece")) {
    return;
  }

  const rows = piecesBody.querySelectorAll("tr");
  if (rows.length === 1) {
    rows[0].querySelectorAll("input").forEach((input, index) => {
      input.value = index === 2 ? "1" : "";
    });
    return;
  }

  const row = findParentRow(event.target);
  if (row) {
    row.remove();
    runAnalysis();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runAnalysis();
});

function runAnalysis() {
  const payload = collectInputs();
  if (!payload.ok) {
    renderError(payload.message);
    return;
  }

  const horizontal = optimizeOrientation("Horizontal", payload.roomWidth, payload.roomHeight, payload.pieces);
  const vertical = optimizeOrientation("Vertical", payload.roomWidth, payload.roomHeight, payload.pieces);
  renderResults(horizontal, vertical, payload.unit);
}

function bootstrapRows() {
  addPieceRow({ width: 12, length: 15, quantity: 1 });
  addPieceRow({ width: 6, length: 15, quantity: 1 });
}

function addPieceRow(defaults = {}) {
  const row = document.createElement("tr");
  row.innerHTML = [
    '<td><input class="piece-width" type="number" min="0.01" step="0.01" required></td>',
    '<td><input class="piece-length" type="number" min="0.01" step="0.01" required></td>',
    '<td><input class="piece-quantity" type="number" min="1" step="1" value="1" required></td>',
    '<td><button type="button" class="icon-button remove-piece">Remove</button></td>'
  ].join("");

  row.querySelector(".piece-width").value = defaults.width ?? "";
  row.querySelector(".piece-length").value = defaults.length ?? "";
  row.querySelector(".piece-quantity").value = defaults.quantity ?? 1;
  piecesBody.appendChild(row);
}

function collectInputs() {
  const roomWidth = parsePositiveNumber(document.getElementById("room-width").value);
  const roomHeight = parsePositiveNumber(document.getElementById("room-height").value);
  const unit = document.getElementById("unit-label").value.trim() || "units";

  if (!roomWidth || !roomHeight) {
    return { ok: false, message: "Enter a valid room width and height." };
  }

  const pieces = [];
  const rows = [...piecesBody.querySelectorAll("tr")];
  for (const row of rows) {
    const width = parsePositiveNumber(row.querySelector(".piece-width").value);
    const length = parsePositiveNumber(row.querySelector(".piece-length").value);
    const quantity = parseInteger(row.querySelector(".piece-quantity").value);

    if (!width || !length || !quantity) {
      return { ok: false, message: "Every carpet piece needs width, length, and quantity." };
    }

    pieces.push({ width, length, quantity });
  }

  if (pieces.length === 0) {
    return { ok: false, message: "Add at least one carpet size." };
  }

  return { ok: true, roomWidth, roomHeight, pieces, unit };
}

function optimizeOrientation(name, roomWidth, roomHeight, pieceGroups) {
  const span = name === "Horizontal" ? roomWidth : roomHeight;
  const target = scale(name === "Horizontal" ? roomHeight : roomWidth);
  const roomArea = roomWidth * roomHeight;
  const units = expandUnits(pieceGroups);
  const base = createDpRow(target + 1);
  base[0] = createState();

  for (const unit of units) {
    const next = base.map((state) => (state ? { ...state } : null));
    const options = buildOptions(unit, span);

    for (let covered = 0; covered <= target; covered += 1) {
      const current = base[covered];
      if (!current) {
        continue;
      }

      for (const option of options) {
        const newCovered = Math.min(target, covered + option.capacityScaled);
        const candidate = {
          area: current.area + option.area,
          pieces: current.pieces + 1,
          spanTrims: current.spanTrims + option.spanTrim,
          capacityScaled: current.capacityScaled + option.capacityScaled,
          picks: [...current.picks, option]
        };

        if (isBetter(candidate, next[newCovered])) {
          next[newCovered] = candidate;
        }
      }
    }

    for (let i = 0; i <= target; i += 1) {
      base[i] = next[i];
    }
  }

  const best = base[target];
  if (!best) {
    return {
      name,
      feasible: false,
      reason: `The listed carpet pieces cannot fully cover the room when fixed in this direction.`
    };
  }

  const waste = round(best.area - roomArea);
  const crossTrim = best.capacityScaled > target ? 1 : 0;
  const cuts = best.pieces + best.spanTrims + crossTrim;
  const seams = Math.max(0, best.pieces - 1);

  return {
    name,
    feasible: true,
    waste,
    cuts,
    seams,
    pieceCount: best.pieces,
    totalArea: round(best.area),
    roomArea: round(roomArea),
    oversupply: round(best.capacityScaled / SCALE - target / SCALE),
    picks: best.picks,
    layout: buildLayoutPlan(name, roomWidth, roomHeight, best.picks)
  };
}

function buildOptions(unit, span) {
  const options = [];
  const seen = new Set();
  const orientations = [
    { parallel: unit.width, perpendicular: unit.length, orientation: "width across span" },
    { parallel: unit.length, perpendicular: unit.width, orientation: "length across span" }
  ];

  for (const entry of orientations) {
    if (entry.parallel + 1e-9 < span) {
      continue;
    }

    const key = `${round(entry.parallel)}-${round(entry.perpendicular)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    options.push({
      id: unit.id,
      width: unit.width,
      length: unit.length,
      orientation: entry.orientation,
      parallel: entry.parallel,
      perpendicular: entry.perpendicular,
      capacityScaled: scale(entry.perpendicular),
      area: unit.width * unit.length,
      spanTrim: entry.parallel > span ? 1 : 0
    });
  }

  return options;
}

function expandUnits(pieceGroups) {
  const units = [];
  let id = 1;
  for (const piece of pieceGroups) {
    for (let count = 0; count < piece.quantity; count += 1) {
      units.push({
        id: id++,
        width: piece.width,
        length: piece.length
      });
    }
  }
  return units;
}

function createDpRow(length) {
  return Array.from({ length }, () => null);
}

function createState() {
  return {
    area: 0,
    pieces: 0,
    spanTrims: 0,
    capacityScaled: 0,
    picks: []
  };
}

function isBetter(candidate, current) {
  if (!current) {
    return true;
  }

  if (candidate.area !== current.area) {
    return candidate.area < current.area;
  }

  const candidateCuts = candidate.pieces + candidate.spanTrims;
  const currentCuts = current.pieces + current.spanTrims;

  if (candidateCuts !== currentCuts) {
    return candidateCuts < currentCuts;
  }

  if (candidate.pieces !== current.pieces) {
    return candidate.pieces < current.pieces;
  }

  return candidate.capacityScaled < current.capacityScaled;
}

function renderResults(horizontal, vertical, unit) {
  clearError();
  resultsSection.classList.remove("hidden");

  const recommendation = pickRecommendation(horizontal, vertical);
  recommendationCard.innerHTML = renderRecommendation(recommendation, unit);
  horizontalCard.innerHTML = renderOrientationCard(horizontal, unit);
  verticalCard.innerHTML = renderOrientationCard(vertical, unit);
}

function pickRecommendation(horizontal, vertical) {
  if (horizontal.feasible && !vertical.feasible) {
    return {
      title: "Recommended: Horizontal fixing",
      body: "Horizontal is the only feasible layout with the current stock pieces.",
      tone: "good"
    };
  }

  if (vertical.feasible && !horizontal.feasible) {
    return {
      title: "Recommended: Vertical fixing",
      body: "Vertical is the only feasible layout with the current stock pieces.",
      tone: "good"
    };
  }

  if (!horizontal.feasible && !vertical.feasible) {
    return {
      title: "No feasible full-span layout",
      body: "None of the listed carpet pieces can cover the room in one-strip spans. You need larger stock pieces or a model that allows joining pieces within a strip.",
      tone: "warn"
    };
  }

  const ordered = [horizontal, vertical].sort(compareResults);
  const best = ordered[0];
  const other = ordered[1];
  const detail = buildComparisonDetail(best, other);

  return {
    title: `Recommended: ${best.name} fixing`,
    body: detail,
    tone: "good"
  };
}

function compareResults(left, right) {
  if (left.waste !== right.waste) {
    return left.waste - right.waste;
  }
  if (left.cuts !== right.cuts) {
    return left.cuts - right.cuts;
  }
  if (left.seams !== right.seams) {
    return left.seams - right.seams;
  }
  return left.pieceCount - right.pieceCount;
}

function buildComparisonDetail(best, other) {
  const parts = [];
  if (best.waste !== other.waste) {
    parts.push(`It saves ${formatNumber(other.waste - best.waste)} more square units of carpet than ${other.name.toLowerCase()}.`);
  }
  if (best.cuts !== other.cuts) {
    parts.push(`It also needs ${other.cuts - best.cuts} fewer cuts.`);
  }
  if (parts.length === 0) {
    parts.push(`Both directions perform the same on waste and cuts, so ${best.name.toLowerCase()} only wins on fewer seams or fewer pieces.`);
  }
  return parts.join(" ");
}

function renderRecommendation(recommendation) {
  return `
    <span class="status ${recommendation.tone}">${recommendation.tone === "good" ? "Best option" : "Attention"}</span>
    <h2>${recommendation.title}</h2>
    <p>${recommendation.body}</p>
  `;
}

function renderOrientationCard(result, unit) {
  if (!result.feasible) {
    return `
      <span class="status warn">Not feasible</span>
      <h3>${result.name}</h3>
      <p>${result.reason}</p>
    `;
  }

  return `
    <span class="status good">Feasible</span>
    <h3>${result.name}</h3>
    <div class="metric-grid">
      <div class="metric">
        <span class="metric-label">Estimated waste</span>
        <strong class="metric-value">${formatNumber(result.waste)} sq ${unit}</strong>
      </div>
      <div class="metric">
        <span class="metric-label">Estimated cuts</span>
        <strong class="metric-value">${result.cuts}</strong>
      </div>
      <div class="metric">
        <span class="metric-label">Seams</span>
        <strong class="metric-value">${result.seams}</strong>
      </div>
      <div class="metric">
        <span class="metric-label">Pieces used</span>
        <strong class="metric-value">${result.pieceCount}</strong>
      </div>
    </div>
    <p>Total selected carpet area: <strong>${formatNumber(result.totalArea)} sq ${unit}</strong></p>
    <p>Unused strip depth after fitting: <strong>${formatNumber(result.oversupply)} ${unit}</strong></p>
    <div class="diagram-panel">
      <h4>Arrangement picture</h4>
      ${renderDiagram(result, unit)}
    </div>
    <div class="diagram-panel">
      <h4>Cut and placement steps</h4>
      <ol class="instruction-list">
        ${buildInstructions(result, unit).map((step) => `<li>${step}</li>`).join("")}
      </ol>
    </div>
    <ul class="piece-list">
      ${result.picks.map(renderPick).join("")}
    </ul>
  `;
}

function renderPick(pick) {
  return `
    <li>
      Piece ${pick.id}: ${formatNumber(pick.width)} x ${formatNumber(pick.length)}
      using ${pick.orientation}, covering ${formatNumber(pick.perpendicular)} units in the cross direction.
    </li>
  `;
}

function renderError(message) {
  resultsSection.classList.remove("hidden");
  recommendationCard.innerHTML = `<div class="error-box">${message}</div>`;
  horizontalCard.innerHTML = "";
  verticalCard.innerHTML = "";
}

function clearError() {
  const errorBox = recommendationCard.querySelector(".error-box");
  if (errorBox) {
    errorBox.remove();
  }
}

function parsePositiveNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function scale(value) {
  return Math.round(value * SCALE);
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value) {
  return round(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(round(value)) ? 0 : 2
  });
}

function findParentRow(element) {
  let current = element;
  while (current && current.tagName !== "TR") {
    current = current.parentElement;
  }
  return current;
}

function buildLayoutPlan(name, roomWidth, roomHeight, picks) {
  const strips = [];
  const span = name === "Horizontal" ? roomWidth : roomHeight;
  let remainingCross = name === "Horizontal" ? roomHeight : roomWidth;

  for (const pick of picks) {
    const usedCross = Math.min(remainingCross, pick.perpendicular);
    const crossTrim = round(pick.perpendicular - usedCross);
    strips.push({
      id: pick.id,
      orientation: pick.orientation,
      spanTrim: pick.spanTrim > 0,
      usedCross: round(usedCross),
      crossTrim,
      parallel: round(pick.parallel),
      perpendicular: round(pick.perpendicular),
      width: round(pick.width),
      length: round(pick.length)
    });
    remainingCross = round(Math.max(0, remainingCross - usedCross));
  }

  return {
    roomWidth: round(roomWidth),
    roomHeight: round(roomHeight),
    span: round(span),
    remainingCross: round(remainingCross),
    strips
  };
}

function buildInstructions(result, unit) {
  const steps = [];
  const crossAxis = result.name === "Horizontal" ? "length" : "width";
  const spanAxis = result.name === "Horizontal" ? "width" : "length";

  result.layout.strips.forEach((strip, index) => {
    const parts = [
      `Place piece ${strip.id} as ${result.name.toLowerCase()} strip ${index + 1}.`,
      `It covers ${formatNumber(strip.usedCross)} ${unit} across the room ${crossAxis}.`
    ];

    if (strip.spanTrim) {
      parts.push(`Trim the long side to match the room ${spanAxis}.`);
    }

    if (strip.crossTrim > 0) {
      parts.push(`Trim ${formatNumber(strip.crossTrim)} ${unit} from the final strip depth.`);
    }

    steps.push(parts.join(" "));
  });

  if (result.seams > 0) {
    steps.push(`Join the ${result.pieceCount} strips in order. This creates ${result.seams} seam${result.seams === 1 ? "" : "s"}.`);
  } else {
    steps.push("Only one strip is needed, so there are no seams between pieces.");
  }

  return steps;
}

function renderDiagram(result, unit) {
  const layout = result.layout;
  const padding = 26;
  const svgWidth = 360;
  const svgHeight = 250;
  const roomWidth = layout.roomWidth || 1;
  const roomHeight = layout.roomHeight || 1;
  const scale = Math.min((svgWidth - padding * 2) / roomWidth, (svgHeight - padding * 2) / roomHeight);
  const roomPixelWidth = roomWidth * scale;
  const roomPixelHeight = roomHeight * scale;
  const colors = [
    { fill: "#d68645", badge: "#8c4b17" },
    { fill: "#7e9f77", badge: "#42663c" },
    { fill: "#5d88b8", badge: "#2f5d90" },
    { fill: "#c96d60", badge: "#8e3f35" },
    { fill: "#9b7cb6", badge: "#624b7c" },
    { fill: "#4d9f96", badge: "#216f69" }
  ];
  const roomX = padding;
  const roomY = padding;
  const isHorizontal = result.name === "Horizontal";

  let offset = 0;
  const stripMarkup = layout.strips.map((strip, index) => {
    const palette = colors[index % colors.length];
    const x = roomX + (isHorizontal ? 0 : offset * scale);
    const y = roomY + (isHorizontal ? offset * scale : 0);
    const width = isHorizontal ? roomPixelWidth : strip.usedCross * scale;
    const height = isHorizontal ? strip.usedCross * scale : roomPixelHeight;
    const labelX = x + width / 2;
    const labelY = y + height / 2;
    const trimLine = strip.spanTrim
      ? isHorizontal
        ? `<line x1="${x + width - 10}" y1="${y + 8}" x2="${x + width - 10}" y2="${y + height - 8}" class="trim-line" />`
        : `<line x1="${x + 8}" y1="${y + height - 10}" x2="${x + width - 8}" y2="${y + height - 10}" class="trim-line" />`
      : "";
    const seamLine = index > 0
      ? isHorizontal
        ? `<line x1="${roomX + 6}" y1="${y}" x2="${roomX + roomPixelWidth - 6}" y2="${y}" class="seam-line" />`
        : `<line x1="${x}" y1="${roomY + 6}" x2="${x}" y2="${roomY + roomPixelHeight - 6}" class="seam-line" />`
      : "";
    const cutBadge = strip.spanTrim || strip.crossTrim > 0
      ? renderCutBadge(strip, x, y, width, height, unit, isHorizontal)
      : "";
    const textClass = width < 80 || height < 44 ? "piece-label small" : "piece-label";

    offset += strip.usedCross;

    return `
      <g>
        ${seamLine}
        <rect x="${x}" y="${y}" width="${Math.max(width, 2)}" height="${Math.max(height, 2)}" rx="14" fill="${palette.fill}" fill-opacity="0.9" class="strip-block"></rect>
        ${trimLine}
        <rect x="${Math.max(x + 8, x + width / 2 - 34)}" y="${Math.max(y + 8, y + height / 2 - 15)}" width="68" height="30" rx="15" fill="${palette.badge}" fill-opacity="0.9"></rect>
        <text x="${labelX}" y="${labelY - 4}" text-anchor="middle" dominant-baseline="middle" class="${textClass}">
          Piece ${strip.id}
        </text>
        <text x="${labelX}" y="${labelY + 10}" text-anchor="middle" dominant-baseline="middle" class="piece-meta">
          ${formatNumber(strip.usedCross)} ${unit}
        </text>
        ${cutBadge}
      </g>
    `;
  }).join("");

  const widthGuideY = roomY + roomPixelHeight + 18;
  const heightGuideX = roomX + roomPixelWidth + 18;
  const legendItems = [
    '<span class="legend-chip"><span class="legend-swatch strip"></span> Carpet strip</span>',
    '<span class="legend-chip"><span class="legend-swatch seam"></span> Seam between strips</span>',
    '<span class="legend-chip"><span class="legend-swatch trim"></span> Trim / cut line</span>'
  ].join("");

  return `
    <div class="diagram-wrap">
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="layout-diagram" role="img" aria-label="${result.name} carpet layout">
        <defs>
          <marker id="arrow-end" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="rgba(31, 41, 51, 0.55)"></path>
          </marker>
        </defs>
        <rect x="${roomX}" y="${roomY}" width="${roomPixelWidth}" height="${roomPixelHeight}" rx="18" class="room-outline"></rect>
        ${stripMarkup}
        <line x1="${roomX}" y1="${widthGuideY}" x2="${roomX + roomPixelWidth}" y2="${widthGuideY}" class="guide-line" marker-start="url(#arrow-end)" marker-end="url(#arrow-end)"></line>
        <text x="${roomX + roomPixelWidth / 2}" y="${widthGuideY + 18}" text-anchor="middle" class="diagram-note strong">
          Width: ${formatNumber(layout.roomWidth)} ${unit}
        </text>
        <line x1="${heightGuideX}" y1="${roomY}" x2="${heightGuideX}" y2="${roomY + roomPixelHeight}" class="guide-line" marker-start="url(#arrow-end)" marker-end="url(#arrow-end)"></line>
        <text x="${heightGuideX + 14}" y="${roomY + roomPixelHeight / 2}" class="diagram-note strong">
          Length: ${formatNumber(layout.roomHeight)} ${unit}
        </text>
      </svg>
      <div class="diagram-legend">${legendItems}</div>
      <p class="diagram-caption">
        Read the layout from top to bottom for horizontal fixing, or left to right for vertical fixing.
      </p>
    </div>
  `;
}

function renderCutBadge(strip, x, y, width, height, unit, isHorizontal) {
  const parts = [];
  if (strip.spanTrim) {
    parts.push("span trim");
  }
  if (strip.crossTrim > 0) {
    parts.push(`${formatNumber(strip.crossTrim)} ${unit} offcut`);
  }

  const badgeWidth = Math.max(78, parts.join(" | ").length * 5.6);
  const badgeHeight = 22;
  const badgeX = isHorizontal ? x + width - badgeWidth - 12 : x + 10;
  const badgeY = isHorizontal ? y + 10 : y + height - badgeHeight - 12;

  return `
    <g>
      <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="11" class="cut-badge"></rect>
      <text x="${badgeX + badgeWidth / 2}" y="${badgeY + 14}" text-anchor="middle" class="cut-badge-text">${parts.join(" | ")}</text>
    </g>
  `;
}
