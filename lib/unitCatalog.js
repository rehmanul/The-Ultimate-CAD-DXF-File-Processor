/*
 * Unit Catalog
 *
 * This module defines a catalog of standard storage unit (îlot) definitions.
 * Each unit type entry specifies a nominal area, a set of allowed dimension
 * templates, a default door width and partition thickness, and flags
 * indicating whether the unit is accessible or premium. You can extend this
 * catalog with additional families or override it in your configuration.
 */

module.exports = {
  // Small units (1–2 m²)
  S: {
    name: 'Small',
    nominalArea: 1.5,
    dimensions: [
      { width: 1.0, depth: 1.5 },
      { width: 1.2, depth: 1.3 }
    ],
    doorWidth: 0.8,
    partitionThickness: 0.05,
    accessible: false,
    premium: false
  },
  // Medium units (2–3 m²)
  M: {
    name: 'Medium',
    nominalArea: 2.5,
    dimensions: [
      { width: 1.5, depth: 1.7 },
      { width: 1.6, depth: 1.6 }
    ],
    doorWidth: 0.9,
    partitionThickness: 0.05,
    accessible: false,
    premium: false
  },
  // Large units (3–5 m²)
  L: {
    name: 'Large',
    nominalArea: 4.0,
    dimensions: [
      { width: 2.0, depth: 2.0 },
      { width: 1.8, depth: 2.2 }
    ],
    doorWidth: 1.0,
    partitionThickness: 0.06,
    accessible: false,
    premium: false
  },
  // Accessible units (2–3 m² with wider doors)
  A: {
    name: 'Accessible',
    nominalArea: 2.5,
    dimensions: [
      { width: 1.6, depth: 1.8 },
      { width: 1.8, depth: 1.6 }
    ],
    doorWidth: 1.2,
    partitionThickness: 0.05,
    accessible: true,
    premium: false
  },
  // Premium units near entrances (3–5 m²)
  P: {
    name: 'Premium',
    nominalArea: 4.0,
    dimensions: [
      { width: 2.0, depth: 2.0 },
      { width: 2.2, depth: 1.8 }
    ],
    doorWidth: 1.0,
    partitionThickness: 0.06,
    accessible: false,
    premium: true
  }
};
