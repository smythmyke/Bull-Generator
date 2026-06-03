/**
 * CPC (Cooperative Patent Classification) lookup endpoint.
 *
 * v1.0: curated static dataset covering all 9 sections + ~80 common subclasses.
 * For codes not in the dataset, returns whatever parent levels we have plus
 * the literal code and a link to USPTO's classification browser.
 *
 * v1.1 (planned): load the full USPTO CPC scheme (~250k entries) so every
 * code resolves to a definition.
 */

// ── Static dataset ──

interface CpcEntry {
  code: string;
  title: string;
}

export const SECTIONS: Record<string, string> = {
  A: "Human Necessities",
  B: "Performing Operations; Transporting",
  C: "Chemistry; Metallurgy",
  D: "Textiles; Paper",
  E: "Fixed Constructions",
  F: "Mechanical Engineering; Lighting; Heating; Weapons; Blasting",
  G: "Physics",
  H: "Electricity",
  Y: "General Tagging of New Technological Developments / Cross-Sectional Technologies",
};

export const SUBCLASSES: Record<string, string> = {
  // A — Human Necessities
  A01B: "Soil working in agriculture or forestry; Parts, details, or accessories of agricultural machines or implements",
  A01N: "Preservation of bodies of humans or animals or plants or parts thereof; Biocides; Pest repellents or attractants",
  A23L: "Foods, foodstuffs, or non-alcoholic beverages, not covered by other subclasses",
  A45F: "Travelling or camp equipment: sacks or packs carried on the body",
  A47B: "Tables; Desks; Office furniture; Cabinets; Drawers; General details of furniture",
  A47G: "Household or table equipment",
  A47J: "Kitchen equipment; Coffee mills; Spice mills; Apparatus for making beverages",
  A61B: "Diagnosis; Surgery; Identification",
  A61F: "Filters implantable into blood vessels; Prostheses; Orthopaedic, nursing or contraceptive devices",
  A61K: "Preparations for medical, dental, or toilet purposes",
  A61M: "Devices for introducing media into, or onto, the body",
  A61N: "Electrotherapy; Magnetotherapy; Radiation therapy; Ultrasound therapy",
  A61P: "Specific therapeutic activity of chemical compounds or medicinal preparations",
  A63B: "Apparatus for physical training, gymnastics, swimming, climbing, or fencing; Ball games; Training equipment",
  A63F: "Card, board, or roulette games; Indoor games using small moving playing bodies; Video games",
  // B — Performing Operations; Transporting
  B01D: "Separation",
  B01J: "Chemical or physical processes, e.g. catalysis or colloid chemistry; their relevant apparatus",
  B23K: "Soldering or unsoldering; Welding; Cladding or plating by soldering or welding; Cutting by applying heat locally",
  B25J: "Manipulators; Chambers provided with manipulation devices",
  B29C: "Shaping or joining of plastics; Shaping of substances in a plastic state, in general",
  B32B: "Layered products",
  B41J: "Typewriters; Selective printing mechanisms",
  B60K: "Arrangement or mounting of propulsion units or of transmissions in vehicles",
  B60L: "Propulsion of electrically-propelled vehicles",
  B60W: "Conjoint control of vehicle sub-units of different type or different function",
  B62D: "Motor vehicles; Trailers",
  B62K: "Cycles; Cycle frames",
  B65D: "Containers for storage or transport of articles or materials",
  B65G: "Transport or storage devices",
  B66F: "Hoisting, lifting, hauling or pushing, not otherwise provided for",
  // C — Chemistry; Metallurgy
  C01B: "Non-metallic elements; Compounds thereof",
  C07C: "Acyclic or carbocyclic compounds",
  C07D: "Heterocyclic compounds",
  C07K: "Peptides",
  C08F: "Macromolecular compounds obtained by reactions only involving carbon-to-carbon unsaturated bonds",
  C08G: "Macromolecular compounds obtained by reactions other than involving carbon-to-carbon bonds",
  C08L: "Compositions of macromolecular compounds",
  C09D: "Coating compositions, e.g. paints, varnishes or lacquers",
  C09K: "Materials for miscellaneous applications, not provided for elsewhere",
  C12N: "Micro-organisms or enzymes; Compositions thereof",
  C12Q: "Measuring or testing processes involving enzymes, nucleic acids or microorganisms",
  C22C: "Alloys",
  // D — Textiles; Paper
  D03D: "Woven fabrics; Methods of weaving; Looms",
  D04H: "Making textile fabrics, e.g. for technical use; Felting non-woven fabrics",
  D06F: "Laundering, drying, ironing, pressing, or folding textile articles",
  // E — Fixed Constructions
  E04B: "General building constructions; Walls; Floors; Ceilings; Roofs",
  E04F: "Finishing work on buildings, e.g. stairs, floors",
  E21B: "Earth or rock drilling; Obtaining oil, gas, water, soluble or meltable materials or a slurry of minerals from wells",
  // F — Mechanical Engineering
  F01D: "Non-positive-displacement machines or engines, e.g. steam turbines",
  F02C: "Gas-turbine plants; Air intakes for jet-propulsion plants",
  F02D: "Controlling combustion engines",
  F02M: "Supplying combustion engines with combustible mixtures or constituents thereof",
  F03D: "Wind motors",
  F16D: "Couplings for transmitting rotation; Clutches; Brakes",
  F16H: "Gearing",
  F21S: "Non-portable lighting devices or systems thereof",
  F21V: "Functional features or details of lighting devices or systems thereof",
  F24F: "Air-conditioning; Air-humidification; Ventilation; Use of air currents for screening",
  F25B: "Refrigeration machines, plants or systems; Combined heating and refrigeration systems",
  F25D: "Refrigerators; Cold rooms; Ice-boxes; Cooling or freezing apparatus",
  F28D: "Heat-exchange apparatus, not provided for in another subclass",
  // G — Physics
  G01N: "Investigating or analysing materials by determining their chemical or physical properties",
  G01S: "Radio direction-finding; Radio navigation; Radar; Pulse-echo systems using waves other than radio waves",
  G02B: "Optical elements, systems, or apparatus",
  G02F: "Optical devices or arrangements for the control of light by modification of the optical properties of the media",
  G06F: "Electric digital data processing",
  G06K: "Graphical data reading; Presentation of data; Record carriers; Handling record carriers",
  G06N: "Computing arrangements based on specific computational models (incl. machine learning, neural networks)",
  G06Q: "Data processing systems or methods, specially adapted for administrative, commercial, financial, managerial, supervisory or forecasting purposes",
  G06T: "Image data processing or generation, in general",
  G06V: "Image or video recognition or understanding",
  G09G: "Arrangements or circuits for control of indicating devices using static means to present variable information",
  G10L: "Speech analysis or synthesis; Speech recognition; Speech or voice processing",
  G11C: "Static stores",
  // H — Electricity
  H01F: "Magnets; Inductances; Transformers; Selection of materials for their magnetic properties",
  H01L: "Semiconductor devices; Electric solid-state devices not otherwise provided for",
  H01M: "Processes or means, e.g. batteries, for the direct conversion of chemical energy into electrical energy",
  H01Q: "Aerials (antennas)",
  H01R: "Electrically-conductive connections; Structural associations of a plurality of mutually-insulated electrical connecting elements",
  H02J: "Circuit arrangements or systems for supplying or distributing electric power; Systems for storing electric energy",
  H02K: "Dynamo-electric machines",
  H02M: "Apparatus for conversion between AC and AC, between AC and DC, or between DC and DC",
  H02P: "Control or regulation of electric motors, electric generators or dynamo-electric converters",
  H02S: "Generation of electric power by conversion of infra-red radiation, visible light or ultraviolet light, e.g. using photovoltaic [PV] modules",
  H03F: "Amplifiers",
  H03K: "Pulse technique",
  H04B: "Transmission",
  H04L: "Transmission of digital information, e.g. telegraphic communication",
  H04M: "Telephonic communication",
  H04N: "Pictorial communication, e.g. television",
  H04R: "Loudspeakers, microphones, gramophone pick-ups or like acoustic electromechanical transducers",
  H04W: "Wireless communication networks",
  H05B: "Electric heating; Electric light sources not otherwise provided for; Circuit arrangements for electric light sources, in general",
  H05K: "Printed circuits; Casings or constructional details of electric apparatus; Manufacture of assemblages of electrical components",
  // Y — Cross-sectional tags
  Y02E: "Reduction of greenhouse gas emissions, related to energy generation, transmission or distribution",
  Y02P: "Climate change mitigation technologies in the production or processing of goods",
  Y02T: "Climate change mitigation technologies related to transportation",
  Y10S: "Technical subjects covered by former US classification cross-reference art collections (XRACs) and digests",
};

// ── Code parsing ──

interface ParsedCode {
  section: string;             // "H"
  classCode: string | null;    // "H01"
  subclass: string | null;     // "H01M"
  mainGroup: string | null;    // "H01M10/00" — note: ends in /00
  subgroup: string | null;     // "H01M10/0525" (when more specific than main group)
}

function parseCpcCode(raw: string): ParsedCode | null {
  if (!raw) return null;
  const code = raw.replace(/\s/g, "").toUpperCase();
  // Section letter must be A-H or Y
  if (!/^[A-HY]/.test(code)) return null;
  const section = code[0];

  // Class: section + 2 digits, e.g. H01
  const classMatch = code.match(/^[A-HY]\d{2}/);
  const classCode = classMatch ? classMatch[0] : null;

  // Subclass: class + letter, e.g. H01M
  const subclassMatch = code.match(/^[A-HY]\d{2}[A-Z]/);
  const subclass = subclassMatch ? subclassMatch[0] : null;

  // Group: subclass + digits + / + digits. Main group ends in /00, e.g. H01M10/00
  // Subgroup is anything else, e.g. H01M10/0525
  let mainGroup: string | null = null;
  let subgroup: string | null = null;
  const groupMatch = code.match(/^([A-HY]\d{2}[A-Z]\d+)\/(\d+)$/);
  if (groupMatch) {
    const prefix = groupMatch[1];
    const suffix = groupMatch[2];
    const full = `${prefix}/${suffix}`;
    if (/^0+$/.test(suffix)) {
      mainGroup = full;
    } else {
      subgroup = full;
      mainGroup = `${prefix}/00`;
    }
  }

  return { section, classCode, subclass, mainGroup, subgroup };
}

// ── Handler ──

export interface CpcResult {
  code?: string;
  section?: CpcEntry | null;
  classification?: CpcEntry | null;   // "class" is a reserved word in TS — using "classification" here
  subclass?: CpcEntry | null;
  mainGroup?: CpcEntry | null;
  subgroup?: string | null;
  uspoBrowserUrl?: string;
  notes?: string;
  error?: string;
  code_err?: "invalid_input";
}

export async function handleCpcRequest(body: { code?: string }): Promise<CpcResult> {
  const raw = typeof body.code === "string" ? body.code.trim() : "";
  if (!raw) {
    return { error: "code is required (e.g. 'H01M' or 'H01M10/0525')", code_err: "invalid_input" };
  }

  const parsed = parseCpcCode(raw);
  if (!parsed) {
    return { error: `Invalid CPC code: ${raw}. Expected format starts with A-H or Y, e.g. 'H01', 'H01M', 'H01M10/00', or 'H01M10/0525'.`, code_err: "invalid_input" };
  }

  const sectionTitle = SECTIONS[parsed.section];
  const subclassTitle = parsed.subclass ? SUBCLASSES[parsed.subclass] : undefined;

  // Browser URL — USPTO's CPC HTML pages organize by subclass
  const browserSubclass = parsed.subclass || parsed.classCode || parsed.section;
  const usptoUrl = `https://www.uspto.gov/web/patents/classification/cpc/html/cpc-${browserSubclass}.html`;

  const notes: string[] = [];
  if (parsed.subclass && !subclassTitle) {
    notes.push(`Subclass ${parsed.subclass} title not in v1.0 dataset — see USPTO browser link for full definition.`);
  }
  if (parsed.subgroup) {
    notes.push(`Subgroup-level descriptions ('${parsed.subgroup}') require the full USPTO CPC scheme; planned for v1.1. Use the USPTO browser link in the meantime.`);
  }

  return {
    code: raw.replace(/\s/g, "").toUpperCase(),
    section: { code: parsed.section, title: sectionTitle },
    classification: parsed.classCode ? { code: parsed.classCode, title: `${parsed.section} — ${sectionTitle} (class ${parsed.classCode})` } : null,
    subclass: parsed.subclass ? { code: parsed.subclass, title: subclassTitle || "" } : null,
    mainGroup: parsed.mainGroup ? { code: parsed.mainGroup, title: "" } : null,
    subgroup: parsed.subgroup,
    uspoBrowserUrl: usptoUrl,
    notes: notes.length > 0 ? notes.join(" ") : undefined,
  };
}
