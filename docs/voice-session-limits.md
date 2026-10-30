# Sprachassistent: Sitzungsgrenzen

## Verhalten

- Die Website beendet eine verbundene Sitzung nach 180 Sekunden. Das ist eine Browsergrenze, keine serverseitige Begrenzung der Deepgram-WebSocket-Sitzung. Das kurzlebige Token kann außerhalb der Website verwendet werden. Ein harter Provider-Cap erfordert eine geprüfte Providerfunktion oder einen verwalteten Proxy.
- Vor jeder Tokenvergabe reserviert die API atomisch einen Start je pseudonymer IP-Kennung: frühestens nach sechs Stunden, höchstens zweimal in einem rollenden Zeitraum von 24 Stunden. Der Zeitpunkt der Tokenvergabe zählt, auch wenn die Verbindung anschließend scheitert. Scheitert schon die Tokenvergabe bei Deepgram, wird die Reservierung freigegeben.
- Personen hinter derselben öffentlichen IP teilen das Limit. Ein Wechsel des HMAC-Schlüssels setzt bestehende Zähler faktisch zurück. Speicher- oder Konfigurationsfehler führen zu HTTP 503; die API gibt dann kein Token aus.

## Erforderliche Vercel-Umgebungsvariablen

| Name | Zweck |
| --- | --- |
| `DEEPGRAM_API_KEY` | Bestehender serverseitiger Deepgram-Schlüssel. |
| `UPSTASH_REDIS_REST_URL` | HTTPS-REST-Endpunkt einer Upstash-Redis-Datenbank. |
| `UPSTASH_REDIS_REST_TOKEN` | Serverseitiges REST-Token für diese Datenbank. |
| `VOICE_IP_HASH_SECRET` | Zufälliger, projektgebundener HMAC-Schlüssel mit mindestens 32 Zeichen. |

Keine Werte in Git, PRs, Logs oder Clientcode schreiben. Die IP wird auf dem Vercel-Server mit HMAC-SHA256 abgeleitet; an Upstash gehen nur die Kennung, ein zufälliger Reservierungsbezeichner und Zeitpunkte. Die Redis-Einträge erhalten 24 Stunden TTL ab dem letzten zugelassenen Start.

## Freigabe und Release

1. Vor Bereitstellung die Nutzung von Upstash, den konkreten Kontoplan und die Übertragung pseudonymer IP-Kennungen freigeben lassen. Vorgeschlagen ist eine einzelne regionale Datenbank in Frankfurt (`eu-central-1`) im **Free-Plan** ohne Zahlungsmethode oder automatische kostenpflichtige Hochstufung. Upstash nennt derzeit 500.000 Befehle/Monat, 256 MB und 10 GB Bandbreite für Free. Dies ist eine Anbieterangabe, kein bestätigter Kontostand. Eine Zahlungsmethode kann laut Upstash vorhandene freie Ressourcen auf Pay-as-you-go umstellen; das wäre eine eigene Kostenentscheidung.
2. Datenverarbeitungsvertrag, tatsächliche Datenregion und Datenschutzhinweise vor Production prüfen. Die HMAC-Kennung bleibt ein pseudonymes personenbezogenes Datum. Die vorgeschlagene Rechtsgrundlage und Interessenabwägung bedürfen fachlicher Prüfung.
3. Nach Freigabe Datenbank und Variablen für die richtigen Vercel-Umgebungen einrichten. Erst dann die Redis-Grenzfälle mit echter Datenbank und den Browserablauf prüfen. Ohne Speicher liefert der Token-Endpunkt absichtlich 503.
4. Vor Production den aktuellen Ready-Deployment-Rücksprungpunkt mit ID, Zeit und Commit festhalten. Nur den freigegebenen Commit deployen; danach feste URL, Deployment-ID und betroffenen Gesprächsablauf getrennt prüfen. Release-Notiz mit Commit, ID, Testergebnis, offenen Grenzen und Rücksprungpunkt erstellen.

Quellen: [Upstash REST API](https://upstash.com/docs/redis/features/restapi), [Upstash EVAL](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval), [Upstash Preise](https://upstash.com/pricing/redis), [Upstash Regionen](https://upstash.com/docs/redis/features/globaldatabase), [Upstash Upgrade](https://upstash.com/docs/redis/howto/upgrade-database), [Vercel Request-Header](https://vercel.com/docs/headers/request-headers), [EDPB zu Pseudonymisierung](https://www.edpb.europa.eu/system/files/2025-02/edpb_summary_202501_pseudonymisation_en.pdf).
