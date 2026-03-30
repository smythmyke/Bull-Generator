import { ConceptForSearch } from '../../src/utils/conceptSearchBuilder';

/**
 * Known-target benchmark fixtures for mobile device patents.
 *
 * Each fixture contains:
 *  - inputText: paragraph a user would paste into the tool
 *  - concepts: what the concept extractor should produce (manually curated ground truth)
 *    with modifiers (specific qualifiers) and nouns (generic objects) for proximity pairing
 *  - targetPatents: patent IDs that MUST appear in results (recall targets)
 *  - irrelevantPatents: patents that should NOT appear (precision sanity check)
 *  - expectedCPCs: CPC codes covering the technology
 */

export interface SearchBenchmark {
  name: string;
  inputText: string;
  concepts: ConceptForSearch[];
  targetPatents: string[];
  irrelevantPatents: string[];
  expectedCPCs: string[];
}

// ── Fixture 1: Foldable hinge mechanism ──

export const FOLDABLE_HINGE: SearchBenchmark = {
  name: 'Foldable phone hinge with waterdrop flex display',
  inputText:
    'A foldable mobile device comprising a hinge mechanism that enables a flexible OLED display to fold inward along a central axis, wherein the hinge includes a waterdrop-shaped cavity that maintains a minimum bend radius to prevent display cracking, and a cam-based linkage system that synchronizes the movement of the two housing halves.',
  concepts: [
    {
      name: 'foldable device',
      synonyms: ['foldable phone', 'foldable mobile device', 'folding electronic device', 'bendable device'],
      modifiers: ['foldable', 'bendable', 'folding', 'collapsible', 'flexible'],
      nouns: ['device', 'phone', 'mobile device', 'electronic device'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'hinge mechanism',
      synonyms: ['hinge assembly', 'folding hinge', 'pivot mechanism', 'hinge module'],
      modifiers: ['hinge', 'pivot', 'folding', 'articulating', 'rotating'],
      nouns: ['mechanism', 'assembly', 'module', 'linkage'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'flexible display',
      synonyms: ['flexible OLED', 'foldable display', 'bendable screen', 'flex screen'],
      modifiers: ['flexible', 'foldable', 'bendable', 'deformable', 'OLED'],
      nouns: ['display', 'screen', 'panel', 'touchscreen'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'waterdrop cavity',
      synonyms: ['waterdrop shape', 'teardrop cavity', 'curved cavity', 'bend radius cavity'],
      modifiers: ['waterdrop', 'teardrop', 'curved', 'concave'],
      nouns: ['cavity', 'recess', 'space', 'channel'],
      enabled: true,
      importance: 'medium',
    },
    {
      name: 'cam linkage',
      synonyms: ['cam mechanism', 'cam-based linkage', 'synchronized linkage'],
      modifiers: ['cam', 'cam-based', 'synchronized', 'geared'],
      nouns: ['linkage', 'mechanism', 'system', 'coupling'],
      enabled: true,
      importance: 'medium',
    },
  ],
  targetPatents: [
    'US20200133335A1', // Samsung foldable hinge with waterdrop
    'US11194353B2',    // Samsung hinge structure for foldable device
    'US20210195836A1', // Huawei foldable with cam hinge
  ],
  irrelevantPatents: [
    'US10234835B2',    // Generic laptop hinge (not mobile/foldable display)
  ],
  expectedCPCs: [
    'G06F1/1616',  // Foldable arrangements for portable computers
    'H05K5/023',   // Housings with foldable or pivoting parts
    'E05D11/10',   // Hinges with cam mechanisms
  ],
};

// ── Fixture 2: Under-display camera ──

export const UNDER_DISPLAY_CAMERA: SearchBenchmark = {
  name: 'Under-display front-facing camera with pixel compensation',
  inputText:
    'A mobile electronic device with a front-facing camera positioned beneath an active display area, wherein pixels overlying the camera module have increased transparency by reducing pixel density or OLED sub-pixel size in a camera region, and a software algorithm compensates for diffraction artifacts caused by the pixel grid above the camera sensor to produce clear selfie images.',
  concepts: [
    {
      name: 'under-display camera',
      synonyms: ['under-screen camera', 'below-display camera', 'sub-display camera', 'hidden camera'],
      modifiers: ['under-display', 'under-screen', 'sub-display', 'below-display', 'hidden'],
      nouns: ['camera', 'camera module', 'imaging sensor', 'image sensor'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'pixel transparency',
      synonyms: ['transparent pixel', 'reduced pixel density', 'pixel arrangement', 'transparent display region'],
      modifiers: ['transparent', 'reduced-density', 'translucent', 'sparse'],
      nouns: ['pixel', 'sub-pixel', 'pixel region', 'display area'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'diffraction compensation',
      synonyms: ['diffraction correction', 'image artifact correction', 'optical compensation', 'diffraction algorithm'],
      modifiers: ['diffraction', 'artifact', 'optical', 'wavefront'],
      nouns: ['compensation', 'correction', 'algorithm', 'processing'],
      enabled: true,
      importance: 'medium',
    },
    {
      name: 'OLED sub-pixel',
      synonyms: ['sub-pixel structure', 'OLED pixel', 'organic light emitting pixel'],
      modifiers: ['OLED', 'organic', 'electroluminescent', 'emissive'],
      nouns: ['sub-pixel', 'pixel', 'element', 'diode'],
      enabled: true,
      importance: 'medium',
    },
    {
      name: 'camera module',
      synonyms: ['image sensor', 'camera sensor', 'imaging module', 'front camera'],
      modifiers: ['front-facing', 'selfie', 'forward', 'integrated'],
      nouns: ['camera', 'sensor', 'imager', 'module'],
      enabled: true,
      importance: 'low',
    },
  ],
  targetPatents: [
    'US11569315B2',    // Samsung under-display camera with pixel compensation
    'US20210111229A1', // ZTE/Nubia under-display camera arrangement
    'US20210013270A1', // Under-display camera with reduced diffraction
  ],
  irrelevantPatents: [
    'US10805500B2',    // Standard notch-based front camera
  ],
  expectedCPCs: [
    'H04N23/57',    // Camera integration in portable devices
    'H10K59/65',    // OLED devices with reduced pixel density regions
    'G02B5/00',     // Optical elements for diffraction control
  ],
};

// ── Fixture 3: Ultrasonic in-display fingerprint ──

export const ULTRASONIC_FINGERPRINT: SearchBenchmark = {
  name: 'Ultrasonic in-display fingerprint sensor',
  inputText:
    'A smartphone incorporating an ultrasonic fingerprint sensor embedded beneath the AMOLED display panel, comprising a piezoelectric transducer array that emits acoustic waves through the display stack, receives reflected signals from finger ridge patterns, and uses beamforming to construct a three-dimensional fingerprint map for biometric authentication, wherein the sensor covers a large active sensing area enabling tap-anywhere unlock.',
  concepts: [
    {
      name: 'ultrasonic fingerprint',
      synonyms: ['ultrasonic biometric sensor', 'acoustic fingerprint', 'ultrasound fingerprint'],
      modifiers: ['ultrasonic', 'acoustic', 'ultrasound', 'sonic'],
      nouns: ['fingerprint', 'fingerprint sensor', 'biometric sensor', 'fingerprint reader'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'in-display sensor',
      synonyms: ['under-display sensor', 'embedded display sensor', 'in-screen sensor', 'below-screen sensor'],
      modifiers: ['in-display', 'under-display', 'embedded', 'in-screen', 'below-screen'],
      nouns: ['sensor', 'detector', 'scanner', 'reader'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'piezoelectric transducer',
      synonyms: ['piezo transducer', 'piezoelectric array', 'acoustic transducer'],
      modifiers: ['piezoelectric', 'piezo', 'piezoceramic', 'PVDF'],
      nouns: ['transducer', 'array', 'element', 'actuator'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'beamforming',
      synonyms: ['beam forming', 'acoustic beamforming', 'signal focusing'],
      modifiers: ['beamforming', 'beam-forming', 'phased-array', 'focused'],
      nouns: ['technique', 'method', 'processing', 'algorithm'],
      enabled: true,
      importance: 'medium',
    },
    {
      name: 'fingerprint map',
      synonyms: ['ridge pattern', 'biometric map', '3D fingerprint', 'three-dimensional fingerprint'],
      modifiers: ['three-dimensional', '3D', 'volumetric', 'topographic'],
      nouns: ['fingerprint map', 'ridge pattern', 'biometric image', 'fingerprint image'],
      enabled: true,
      importance: 'medium',
    },
  ],
  targetPatents: [
    'US10891466B2',    // Qualcomm ultrasonic fingerprint with beamforming
    'US11017249B2',    // Samsung ultrasonic fingerprint under AMOLED
    'US20200089920A1', // Qualcomm large-area ultrasonic sensor
  ],
  irrelevantPatents: [
    'US9639765B2',     // Optical (non-ultrasonic) fingerprint
  ],
  expectedCPCs: [
    'G06V40/1382',  // Fingerprint acquisition using ultrasound
    'H10N30/00',    // Piezoelectric devices
    'G06V40/13',    // Fingerprint image acquisition
  ],
};

// ── Fixture 4: Multi-camera computational photography ──

export const MULTI_CAMERA_COMPUTATIONAL: SearchBenchmark = {
  name: 'Multi-camera night mode with semantic-aware HDR fusion',
  inputText:
    'A mobile device camera system comprising a wide-angle lens module and a telephoto lens module that simultaneously capture image frames in low-light conditions, wherein a neural network performs semantic segmentation to identify scene regions such as sky, faces, and foreground objects, and applies region-specific exposure fusion and noise reduction to produce a high dynamic range photograph with preserved detail in both highlights and shadows.',
  concepts: [
    {
      name: 'multi-camera system',
      synonyms: ['dual camera', 'camera array', 'multiple lens', 'multi-lens camera'],
      modifiers: ['multi-camera', 'dual', 'multiple', 'plural', 'array'],
      nouns: ['camera system', 'camera module', 'lens module', 'imaging system'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'night mode',
      synonyms: ['low-light capture', 'low light photography', 'night photography', 'dark scene capture'],
      modifiers: ['low-light', 'night', 'dark', 'dim', 'nocturnal'],
      nouns: ['capture', 'photography', 'imaging', 'mode'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'semantic segmentation',
      synonyms: ['scene segmentation', 'image segmentation', 'region classification', 'semantic analysis'],
      modifiers: ['semantic', 'scene', 'pixel-level', 'region-based'],
      nouns: ['segmentation', 'classification', 'partitioning', 'labeling'],
      enabled: true,
      importance: 'high',
    },
    {
      name: 'HDR fusion',
      synonyms: ['exposure fusion', 'high dynamic range', 'HDR merge', 'tone mapping'],
      modifiers: ['HDR', 'high-dynamic-range', 'multi-exposure', 'bracketed'],
      nouns: ['fusion', 'merge', 'blending', 'compositing'],
      enabled: true,
      importance: 'medium',
    },
    {
      name: 'noise reduction',
      synonyms: ['denoising', 'noise suppression', 'noise removal', 'image denoiser'],
      modifiers: ['noise', 'denoise', 'temporal', 'spatial'],
      nouns: ['reduction', 'suppression', 'removal', 'filtering'],
      enabled: true,
      importance: 'low',
    },
  ],
  targetPatents: [
    'US11190706B2',    // Apple multi-camera semantic HDR
    'US10924688B2',    // Google Night Sight multi-frame fusion
    'US20210203838A1', // Samsung multi-camera low-light processing
  ],
  irrelevantPatents: [
    'US9918017B2',     // Single-camera basic HDR (no multi-cam, no semantic)
  ],
  expectedCPCs: [
    'H04N23/951',   // Multi-camera systems
    'G06T5/50',     // Image enhancement / noise reduction
    'G06V10/267',   // Semantic segmentation
  ],
};

export const ALL_BENCHMARKS: SearchBenchmark[] = [
  FOLDABLE_HINGE,
  UNDER_DISPLAY_CAMERA,
  ULTRASONIC_FINGERPRINT,
  MULTI_CAMERA_COMPUTATIONAL,
];
