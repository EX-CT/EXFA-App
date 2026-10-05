# Test fixtures

- `mini-dataset.json.gz`: a slice of the EVE static data (© CCP hf., `data/LICENSE.EVE`), rebuilt with
  `node tools/make-test-dataset.mjs`.
- `pyfa-saveddata.db`: a Pyfa saved-fits database (SQLite) written by Pyfa itself (pyfa-org/Pyfa @1d9f72b,
  GPL-3.0) through its own `saveddata` layer. The script that drives Pyfa is kept outside this repository,
  so no Pyfa code is in this MIT repository; the file is data only. It holds four fits that cover the
  importer: *Pyfa Rifter* (offline gun, overheated afterburner, 1 of 2 drones active, cargo, notes, low-sec,
  user damage pattern and target profile), *Pyfa Vexor* (mutated webifier, implant, booster, custom
  character with skills and security status, the Rifter projected at 5 km, the Svipul as command fit),
  *Pyfa Thanatos* (fighters, abilities) and *Pyfa Svipul* (T3D mode, All 0), plus the implant set *Pyfa Set*.
- `pyfa-saveddata.stats.json`: the stats Pyfa computed for those fits (EHP, DPS vs the fit's target profile,
  speed, CPU, ...). `src/formats/pyfadb.test.ts` checks the import and `tools/e2e.mjs`
  (`web.e2e.pyfa-db-stats`) checks the engine numbers of the imported fits against these values.
