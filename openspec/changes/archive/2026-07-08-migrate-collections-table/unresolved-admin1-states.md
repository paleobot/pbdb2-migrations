# Unresolved `admin1` (state/province) values — collections migration

_Generated from `pbdb_archive.collections` during the `migrate-collections-table` migration. Regenerate with the resolver in `migrate-collections.js`._

## What this is

During migration, each legacy `country`/`state` is resolved to ISO codes against
`dictionaries.admin0` / `dictionaries.admin1` (with diacritic/punctuation
normalization + curated alias maps). A **country** that resolves populates
`collection.location.toponym.administrativeArea.admin0`; a **state** that resolves
populates `admin1`.

The `admin1` requirement was **relaxed for migration**, so a state that does *not*
resolve no longer drops the collection — it migrates **country-only**
(`administrativeArea: { admin0 }`, no `admin1`) and is flagged. There is no free-text
state field (`admin1` must be a dictionary ISO code), so the raw state string is instead
**preserved in `location.comments`** as a marker line:

```
[migration] Unrecognized admin1 name: <raw state>
```

joined to any existing `geogcomments` with a newline (marker last). Nothing is lost:
the record itself now carries the original string, and `collection.legacyIDs.oldpbdbID`
preserves the link, so a later pass can seed `STATE_ALIASES` and the migration re-run
(idempotent `TRUNCATE` + reload) will resolve them into proper `admin1` codes.

## Why these don't map (it is not a resolver bug)

The `admin1` dictionary uses **canonical, English geonames names**, while legacy `state`
uses vernacular, transliterated, historic, or finer-grained values. The mismatch has
three flavors:

1. **Language / transliteration variants** — e.g. `Bayern` (German) vs dict **Bavaria**;
   `Xizang` (Pinyin) vs dict **Tibet**; the many Russian forms
   (`Yakutiya`/`Yakutia`/`Sakha`, `Primorsky Krai`/`Primorskiy Kray`,
   `Rostovskaya Oblast'`).
2. **Non-exact / partial names** — e.g. `Newfoundland` vs dict
   **Newfoundland and Labrador**.
3. **Granularity mismatch** — e.g. French **departments** (`Landes`) when the dictionary
   only carries **regions** (Brittany, Île-de-France, …); and legacy super-regions that
   are not `admin1` at all (`Siberia`, `West Siberia`, `Far East`, `Central`).

Closing these requires domain knowledge per country (a curated `STATE_ALIASES` seeded
with the correct ISO for each variant, and/or expanding the `admin1` dictionary). Some
entries (super-regions, `not applicable`, single-letter values) are not mappable at all.

## Russia (`RU`) — unresolved states

- Distinct unresolved state strings: **218**
- Collections migrated country-only because of them: **3679**
- (For reference, an additional **7093** RU collections had **no state at all**
  and also migrate country-only.)

| rows | legacy `state` |
|---:|---|
| 428 | Siberia |
| 262 | Orenburg |
| 251 | Kaliningrad |
| 181 | Yakutiya |
| 152 | Krasnoyarsk |
| 151 | Komi Republic |
| 130 | Bashkortostan |
| 123 | Chita |
| 117 | Primorsky Krai |
| 108 | Krasnoyar |
| 96 | Primorskiy Kray |
| 84 | Nenets Autonomous Okrug |
| 72 | Buryatia |
| 60 | Kemerovo |
| 60 | Sakhalin |
| 52 | Yakutia |
| 49 | Saratov |
| 48 | Arkhangelsk |
| 46 | Tuva |
| 43 | Karachay-Cherkessia |
| 43 | Vologda |
| 39 | Khakasiya |
| 37 | Kemorovo |
| 34 | Kirov |
| 31 | Tatarstan |
| 26 | Krasnoyarskiy Kray |
| 26 | Perm |
| 25 | Samara |
| 24 | Irkutsk |
| 24 | Rostovskaya |
| 24 | Tomsk |
| 24 | Volgograd |
| 21 | Omsk |
| 21 | Tyva |
| 21 | Vladimir |
| 20 | Khabarovsk Krai |
| 19 | Chitinskaya oblast |
| 19 | Gorny Altai |
| 19 | Khanty-Mansi Autonomous Okrug |
| 19 | Sverdlovsk |
| 16 | Arkangelsk |
| 16 | Buryat |
| 15 | Kemerovskaya Oblast |
| 15 | Moskovskaya Oblast |
| 14 | Arkhangel'skaya Oblast' |
| 12 | Northern Urals |
| 12 | Novosibirsk |
| 12 | Sverdlovskaya Oblast |
| 12 | Ul'yanovsk |
| 12 | Vokhov area |
| 11 | Ingria |
| 11 | Suksun |
| 11 | Tyumenskaya |
| 10 | Karachaevo-Cherkessiya |
| 10 | Komi republic |
| 10 | Ryazan |
| 10 | Severnaya Zemlya |
| 8 | Adygea |
| 8 | Altay |
| 8 | Penza |
| 8 | West Siberia |
| 7 | Evenki |
| 7 | Magadan |
| 7 | Novaya Zemlya |
| 7 | Respublika Saha (Jakutija) |
| 7 | South Primorye |
| 7 | Udmurtia |
| 7 | Zabaykal'ye |
| 6 | Anadyr-Koryakskii Region |
| 6 | Bashkir |
| 6 | Evenki Autonomous Okrug |
| 6 | Kaliningradskaya Oblast |
| 6 | Kazan |
| 6 | Nenetsia |
| 6 | Nizhnii Novgorod |
| 6 | Orenburgskaya Oblast |
| 6 | Saratovskaya Oblast |
| 6 | Taimyr |
| 6 | Tambov |
| 6 | Taymyr |
| 5 | Adygea republic |
| 5 | Altai (Region) |
| 5 | Amur |
| 5 | Arkhangel'skaya |
| 5 | Kalmykia |
| 5 | Kaluga |
| 5 | Krasnodar |
| 5 | Moskva |
| 5 | Novosibirskaya Oblast |
| 5 | Respublika Komi |
| 5 | Rostovskaya Oblast' |
| 5 | Sakhalinskaya |
| 4 | Belgorod |
| 4 | Chuvasia Republic |
| 4 | City of St. Petersburg |
| 4 | Kostroma |
| 4 | Krasnodarskiy Kray |
| 4 | Kursk |
| 4 | Leningrad |
| 4 | Leningrad oblast |
| 4 | Leningrad Oblast |
| 4 | Primorskiy |
| 4 | Stavropol |
| 4 | Stavropol'skaya |
| 4 | Sverdlovskaya |
| 4 | Tula |
| 4 | Voronezh |
| 4 | Western Transbaikalia |
| 3 | Adygeya |
| 3 | Bryansk |
| 3 | Chelyabinskaya Oblast |
| 3 | Chukot |
| 3 | Evenk Autonomous District |
| 3 | Khaskassia |
| 3 | Leningrad district |
| 3 | Leningrad Region |
| 3 | Maritime Territory |
| 3 | Nizhni Novgorod |
| 3 | Tiumensky |
| 3 | Transbaikalia |
| 3 | Verkhoyansk |
| 3 | Yaroslavl |
| 2 | Adygeia |
| 2 | Arkhangel'sk |
| 2 | Astrakhan |
| 2 | Chuvash |
| 2 | Gorniy Altay |
| 2 | Gorniy Altay Republic |
| 2 | Ivanovo |
| 2 | Karachayevo-Cherkesiya |
| 2 | Khabarovskiy Kray |
| 2 | Komi Republits |
| 2 | Leningrad region |
| 2 | Lipetsk |
| 2 | Nizhegorod |
| 2 | Nizhny Novgorod |
| 2 | North Ossetia |
| 2 | Oblast Leningrad |
| 2 | Pechora |
| 2 | Primorsky |
| 2 | Republic of Adygea |
| 2 | Respublika Barschkortostan |
| 2 | Sakha Republic |
| 2 | Severnaya Osetiya |
| 2 | Severnaya Osetiya-Alaniya |
| 2 | Uchur-Maya |
| 2 | Ulyanovsk Oblast |
| 2 | West-Sibiria |
| 1 | Anadyr |
| 1 | Archangel'sk |
| 1 | Belokalitvenskii |
| 1 | Bryanskaya Oblast |
| 1 | Buzulukskij |
| 1 | Central |
| 1 | Charchyk |
| 1 | Chechen Republic |
| 1 | Chelyabinskaya |
| 1 | Chuvashia |
| 1 | Evenkiyskiy Avtonomnyy Okrug |
| 1 | Far East |
| 1 | Gorny Altay |
| 1 | Gorny Atlai |
| 1 | Gorny-Altai |
| 1 | Gornyi Altai |
| 1 | Goryachii |
| 1 | Kabardino-Balkarian |
| 1 | Kalingrad |
| 1 | Kanin Peninsula |
| 1 | Khabarovsky Krai |
| 1 | Khakassia |
| 1 | Khanta-Fansiysky |
| 1 | Kishertskij |
| 1 | Koltenyi Island |
| 1 | Kouban |
| 1 | Krasnodar. Kray |
| 1 | Krasnojarsk |
| 1 | Krasnoyarsk Territory |
| 1 | Leningrag oblast |
| 1 | Mari El Republic |
| 1 | Moskovskaya oblast |
| 1 | Nerchinsk |
| 1 | North Osetiya |
| 1 | North Russia |
| 1 | not applicable |
| 1 | Novgorod |
| 1 | Novokuznetsk |
| 1 | Oblast |
| 1 | Oryol |
| 1 | Osetiya |
| 1 | Ossetia |
| 1 | Primor'ye |
| 1 | Pskovskaya oblast |
| 1 | Pugatchov, Saratov |
| 1 | Republic of Sakha (Yakutia) |
| 1 | Russia |
| 1 | Saint Petersburg |
| 1 | Saint-Petersburg |
| 1 | Sakha Republic (Yakutiya) |
| 1 | Sakhalin Island |
| 1 | Salair |
| 1 | saratov |
| 1 | Tenkinskii |
| 1 | Transbaikal |
| 1 | Tulskaya Oblast |
| 1 | Tverskaya oblast |
| 1 | Tyumen |
| 1 | Udmurt |
| 1 | Udmurtiya |
| 1 | Vologodskaya |
| 1 | Vorkuta |
| 1 | Voronezhskaya |
| 1 | West-Siberia |
| 1 | Wrangel Island |
| 1 | Y |
| 1 | Yakut |
| 1 | Yakutia-Sakha Republic |
| 1 | Yakutsk |
| 1 | Yakutzk |

## Other countries — top unresolved states (context)

The same gap affects other countries; the highest-volume non-RU cases are below (full
resolution of these is likewise a `STATE_ALIASES`/dictionary-curation task).

| rows | country | legacy `state` |
|---:|:--:|---|
| 865 | CN | Xizang |
| 557 | CN | Nei Mongol |
| 352 | FR | Landes |
| 327 | NZ | South Island |
| 302 | CA | Newfoundland |
| 298 | DE | Bayern |
| 291 | ES | Granada |
| 277 | MN | Omnogov |
| 267 | CO | Huila |
| 241 | CO | La Guajira |
| 235 | ES | Cataluña |
| 229 | EE | Harju |
| 225 | GB | Yorkshire |
| 206 | DE | Nordrhein-Westfalen |
| 195 | GB | Dorset |
| 183 | DE | Hessen |
| 170 | IT | Trentino |
| 167 | GB | Gloucestershire |
| 167 | GB | Shropshire |
| 165 | TN | Madanin |
| 164 | ID | Timor |
| 158 | MG | Mahajanga |
| 157 | CL | Copiapó |
| 149 | CL | Huasco |
| 147 | GB | Somerset |
| 141 | NO | Spitsbergen |
| 140 | DE | Niedersachsen |
| 138 | SE | Dalarne |
| 134 | ES | Teruel |
| 128 | NZ | North Island |
| 121 | BE | Namur |
| 118 | EG | Western Desert |
| 115 | IT | South Tyrol |
| 108 | IN | Kashmir |
| 108 | PT | Centro |
| 107 | FR | Deux-Sèvres |
| 105 | CL | Coquimbo |
| 99 | FR | Languedoc-Roussillon |
| 98 | NO | Asker |
| 96 | ES | Granda |

_Total non-RU unresolved-state collections: **24865** across
**2634** distinct country/state strings (top 40 shown)._
