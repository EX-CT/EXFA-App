// Fit formats layer: every fit that enters the app as text (EFT, DNA, ESI JSON, share links …) is parsed here into
// a StructuredFit, structured JSON with type ids only. The engines accept only structured fits plus skills (format
// parsing is a frontend concern; engine RPC/WASM drops it), so nothing below this layer ever sees fit text.
// The parser behind it is swappable (FitFormats): today the built-in TypeScript parsers (builtin.ts). Later it can
// be the exfa-formats WASM package from EX-CT/EXFA-Engine, which implements the same interface without the UI changing.
import type { Slot } from '../data/dataset';

export type ModState = 'offline' | 'online' | 'active' | 'overheated';
export interface StructuredMutation { base_type_id: number; mutaplasmid_type_id: number; attributes: Record<string, number> }
export interface StructuredModule {
  /** fitted type: for a mutated module the mutaplasmid's output (abyssal) type, with `mutation` naming the base */
  type_id: number; slot: Slot; state: ModState; charge_type_id: number | null; mutation?: StructuredMutation | null;
  /** spool-up as a fraction of max (0..1), null/absent = the fit's default */
  spool?: number | null;
}
/** A fit as structured JSON. Field names follow the engine contract FitRequest (EXFA-Docs 05-api-schema) where
 *  the two overlap (ship, modules, drones, fighters, implants, boosters, cargo); name / notes are library metadata. */
export interface StructuredFit {
  name: string; notes?: string;
  ship: { type_id: number; mode_type_id?: number | null };
  modules: StructuredModule[];
  drones: { type_id: number; quantity: number; active: number; mutation?: StructuredMutation | null }[];
  fighters: { type_id: number; quantity: number; active: boolean; abilities?: number[] | null }[];
  implants: number[];
  boosters: { type_id: number; side_effects?: number[] }[];
  cargo: { type_id: number; quantity: number }[];
}

/** Import formats (exfa-formats `format_import`: Pyfa's detection order for `auto`). The built-in parsers read
 *  eft, dna and esi only. */
export type ImportFormat = 'auto' | 'eft' | 'dna' | 'dna_alt' | 'dna_link' | 'esi' | 'xml' | 'eftcfg';
export type ExportFormat = 'eft' | 'dna' | 'esi' | 'xml' | 'multibuy' | 'shipstats';
export interface ParseResult { /** detected kind, e.g. "EFT", "DNA", "JSON", "XML" */ kind: string; fits: StructuredFit[]; warnings: string[] }
/** What an export sees: the full engine request of the fit (FitRequest JSON: ship, modules … plus character, options),
 *  its name and notes, and for `shipstats` the engine stats of `shipstatsRequest(fit)`. */
export interface ExportInput { name: string; notes?: string; fit: Record<string, unknown>; stats?: unknown }
/** Export switches (exfa-formats `options`: implants, mutations, loaded_charges, boosters, cargo, charges, formatting). */
export type ExportOptions = Record<string, boolean>;

/** A fit-format implementation. `parse` throws on input it cannot read; recoverable problems (unknown item names,
 *  bad mutations …) are `warnings` and the item is skipped. Several fits in one text (a Pyfa multi-export, XML)
 *  come back as several `fits`. */
export interface FitFormats {
  readonly id: string;
  readonly label: string;
  readonly importFormats: ImportFormat[];
  readonly exportFormats: ExportFormat[];
  parse(text: string, format?: ImportFormat, path?: string): ParseResult;
  export(input: ExportInput, format: ExportFormat, opts?: ExportOptions): string;
}

/** The request whose stats the `shipstats` export needs (exfa-formats `shipstats_request`): all attributes and
 *  no spool-up instead of the fit's spool settings, unrounded floats (`full_precision`, exfa 11cc19d). */
export function shipstatsRequest(req: Record<string, any>): Record<string, unknown> {
  return {
    ...req,
    options: { ...(req.options ?? {}), include_attributes: 'all', full_precision: true, default_spool: { type: 'spool_scale', amount: 0 } },
    modules: (req.modules ?? []).map((m: Record<string, unknown>) => ({ ...m, spool: null })),
  };
}

// ---- libraries (several fits with their profiles, characters and links), e.g. a Pyfa saved-fits database ----

/** A projected module / drone / fighter in a library fit (the engine contract's projected entries, flattened). */
export interface StructuredProjected {
  kind: 'module' | 'drone' | 'fighter'; type_id: number; amount: number; distance_m: number | null;
  state?: ModState; charge_type_id?: number | null; quantity?: number; active?: boolean;
}
/** A fit of a library: a StructuredFit plus references (`ref`, local to the library) to its character, profiles and
 *  linked fits (projected fits, fleet booster fits), and library metadata. */
export interface StructuredLibraryFit extends StructuredFit {
  ref: string;
  character_ref?: string | null; damage_pattern_ref?: string | null; target_profile_ref?: string | null;
  system_security?: 'hisec' | 'lowsec' | 'nullsec' | 'wspace' | null;
  environment?: number[]; projected?: StructuredProjected[];
  projected_fits?: { ref: string; amount: number; distance_m: number | null }[]; booster_fit_refs?: string[];
  /** base attribute values for every item of a type in the fit */
  overrides?: { type_id: number; attribute_id: number; value: number }[];
  folder?: string | null; tags?: string[]; created?: string | null; modified?: string | null;
}
export interface StructuredCharacter { ref: string; name: string; default_level: number; levels: Record<string, number>; security_status?: number | null; builtin?: 'all5' | 'all4' | 'all0' }
export interface StructuredProfile { ref: string; name: string; em: number; thermal: number; kinetic: number; explosive: number;
  signature_radius?: number | null; max_velocity?: number | null; radius?: number | null }
export interface StructuredLibrary {
  kind: string; fits: StructuredLibraryFit[]; characters: StructuredCharacter[];
  damage_patterns: StructuredProfile[]; target_profiles: StructuredProfile[]; implant_sets: { ref: string; name: string; implants: number[] }[];
  warnings: string[];
}
