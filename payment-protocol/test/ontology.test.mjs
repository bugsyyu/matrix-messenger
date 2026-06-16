import { WORLD, ontologyJsonLd, ontologyTurtle } from '../src/ontology.mjs';

const fails = [];
const ok   = (m) => console.log('ok  ', m);
const fail = (m) => { fails.push(m); console.error('FAIL', m); };

const ld = ontologyJsonLd();
ok('jsonld root @id'); if (ld['@id'] !== WORLD.id) fail('id mismatch');
if (ld['@type'] === 'Protocol') ok('jsonld @type = Protocol'); else fail('@type wrong');
if (Array.isArray(ld.classes)   && ld.classes.length   === 6) ok('6 classes published'); else fail('classes count');
if (Array.isArray(ld.relations) && ld.relations.length === 9) ok('9 relations published'); else fail('relations count');
if (Array.isArray(ld.actions)   && ld.actions.length   === 6) ok('6 actions published'); else fail('actions count');
if (ld.channel_params.challenge_window_ms > 0) ok('channel_params present'); else fail('channel_params');
if (ld.trust_params.cold_start > 0 && ld.trust_params.cold_start < 1) ok('trust_params present'); else fail('trust_params');
if (ld.agent_contract.minimal_loop.length >= 5) ok('agent contract loop'); else fail('agent contract');

const ttl = ontologyTurtle();
if (ttl.includes('iap:Protocol')) ok('ttl Protocol class'); else fail('ttl missing Protocol');
if ((ttl.match(/a owl:Class/g) || []).length === 6) ok('ttl 6 owl:Class'); else fail('ttl Class count');
if ((ttl.match(/a owl:ObjectProperty/g) || []).length === 9) ok('ttl 9 owl:ObjectProperty'); else fail('ttl prop count');
if ((ttl.match(/a iap:Action/g) || []).length === 6) ok('ttl 6 actions'); else fail('ttl actions');

const haveOpen   = ld.actions.find((a) => a['schema:identifier'] === 'open');
const haveClose  = ld.actions.find((a) => a['schema:identifier'] === 'request_close');
const haveChalle = ld.actions.find((a) => a['schema:identifier'] === 'challenge');
const haveSettle = ld.actions.find((a) => a['schema:identifier'] === 'settle');
const haveObserve= ld.actions.find((a) => a['schema:identifier'] === 'observe');
if (haveOpen && haveClose && haveChalle && haveSettle && haveObserve) ok('all 5 protocol actions in surface');
else fail('missing one of open/close/challenge/settle/observe');

console.log('\n--- digest ---');
console.log('classes:    ', WORLD.classes.map((c) => c.id).join(', '));
console.log('relations:  ', WORLD.relations.map((r) => r.id).join(', '));
console.log('actions:    ', WORLD.actions.map((a) => a.id).join(', '));
console.log('jsonld bytes:', JSON.stringify(ld).length);
console.log('turtle bytes:', ttl.length);

if (fails.length) { console.error('\n' + fails.length + ' failures'); process.exit(1); }
console.log('\nontology surface OK');
