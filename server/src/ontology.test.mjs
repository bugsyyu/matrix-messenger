// Tiny self-test: ensure ontology surfaces are valid JSON-LD + Turtle and contain core terms.
import { WORLD, ontologyJsonLd, ontologyTurtle, agentSdkSource } from './ontology.mjs';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('ok  ', msg); } };

const ld = ontologyJsonLd();
assert(ld['@context'], 'jsonld has @context');
assert(ld['@type'] === 'World', 'jsonld root is World');
assert(Array.isArray(ld.districts) && ld.districts.length === 6, 'jsonld has 6 districts');
assert(ld.physics.planet_radius_m === 50, 'jsonld physics radius');
assert(ld.network.realm_data_schema.p, 'jsonld network schema p');
assert(ld.actions.length >= 5, 'jsonld actions ≥ 5');

const ttl = ontologyTurtle();
assert(ttl.includes('mm:World'), 'ttl has World class');
assert(ttl.includes('mm:District'), 'ttl has District class');
assert((ttl.match(/a mm:District/g) || []).length === 6, 'ttl has 6 districts');
assert(ttl.includes('schema:'), 'ttl uses schema.org');

const sdk = agentSdkSource();
assert(sdk.includes('class AgentClient'), 'sdk exports AgentClient');
assert(sdk.includes('ingestOntology'), 'sdk has ingestOntology');
assert(sdk.includes('goto('), 'sdk has goto()');
assert(sdk.includes('JSON.stringify({ r:'), 'sdk speaks microrealm join_room');

console.log('\n--- WORLD digest ---');
console.log('districts:', WORLD.districts.map((d) => d.id).join(', '));
console.log('delivery_types:', WORLD.delivery_types.map((t) => t.id).join(', '));
console.log('actions:', WORLD.actions.map((a) => a.id).join(', '));
console.log('jsonld bytes:', JSON.stringify(ld).length);
console.log('turtle bytes:', ttl.length);
console.log('sdk bytes:   ', sdk.length);
