import { ConceptForSearch } from '../../src/utils/conceptSearchBuilder';

/**
 * Real-world recall test: US12201049B2
 * "Work machines, control systems for work machines, and methods of operating work machines"
 *
 * Construction/mining equipment patent about ground engagement tools
 * with mounted sensors and a controller.
 */

export const GROUND_ENGAGEMENT_PATENT = {
  name: 'Ground engagement tool with sensor (US12201049B2)',
  patentId: 'US12201049B2',
  abstract:
    'Work machines, control systems for work machines, and methods of operating work machines. A work machine includes a frame structure, a work implement, and a control system. The work implement is coupled to the frame structure and includes at least one ground engagement tool that is configured for movement in response to interaction with an underlying surface in use of the use work machine. The control system is coupled to the frame structure and includes a sensor mounted to the at least one ground engagement tool and a controller communicatively coupled to the sensor.',

  // ── Manually curated concepts (what a good AI extraction should produce) ──

  conceptsWithModifiers: [
    {
      name: 'work machine',
      synonyms: ['construction machine', 'earthmoving machine', 'heavy equipment', 'mining machine'],
      modifiers: ['work', 'construction', 'earthmoving', 'mining', 'heavy'],
      nouns: ['machine', 'equipment', 'vehicle', 'apparatus'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'ground engagement tool',
      synonyms: ['ground engaging tool', 'earth engaging tool', 'digging tool', 'excavation tool'],
      modifiers: ['ground-engaging', 'earth-engaging', 'digging', 'excavating', 'ground engagement'],
      nouns: ['tool', 'implement', 'element', 'component'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'work implement',
      synonyms: ['bucket', 'blade', 'ripper', 'attachment', 'working tool'],
      modifiers: ['work', 'working', 'operational', 'attached'],
      nouns: ['implement', 'attachment', 'bucket', 'blade'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'sensor mounted',
      synonyms: ['sensor attached', 'mounted sensor', 'tool sensor', 'wear sensor'],
      modifiers: ['mounted', 'attached', 'embedded', 'integrated', 'affixed'],
      nouns: ['sensor', 'detector', 'transducer', 'monitor'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'control system',
      synonyms: ['controller', 'control unit', 'electronic controller', 'machine controller'],
      modifiers: ['control', 'electronic', 'automated', 'digital'],
      nouns: ['system', 'controller', 'unit', 'module'],
      enabled: true,
      importance: 'medium' as const,
    },
    {
      name: 'frame structure',
      synonyms: ['chassis', 'machine frame', 'structural frame', 'body frame'],
      modifiers: ['frame', 'structural', 'chassis', 'main'],
      nouns: ['structure', 'frame', 'body', 'chassis'],
      enabled: true,
      importance: 'low' as const,
    },
  ] satisfies ConceptForSearch[],

  // Legacy flat concepts (simulating old AI extraction without modifiers/nouns)
  conceptsLegacy: [
    {
      name: 'work machine',
      synonyms: ['construction machine', 'earthmoving machine', 'heavy equipment', 'mining machine'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'ground engagement tool',
      synonyms: ['ground engaging tool', 'earth engaging tool', 'digging tool', 'excavation tool'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'work implement',
      synonyms: ['bucket', 'blade', 'ripper', 'attachment', 'working tool'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'sensor mounted',
      synonyms: ['sensor attached', 'mounted sensor', 'tool sensor', 'wear sensor'],
      enabled: true,
      importance: 'high' as const,
    },
    {
      name: 'control system',
      synonyms: ['controller', 'control unit', 'electronic controller', 'machine controller'],
      enabled: true,
      importance: 'medium' as const,
    },
    {
      name: 'frame structure',
      synonyms: ['chassis', 'machine frame', 'structural frame', 'body frame'],
      enabled: true,
      importance: 'low' as const,
    },
  ] satisfies ConceptForSearch[],

  // Likely CPC codes for this technology area
  expectedCPCs: [
    'E02F9/26',   // Indicating devices for ground engagement tools
    'E02F3/40',   // Dredgers or soil-shifting machines with monitoring
    'G01N3/56',   // Wear testing
  ],
};
