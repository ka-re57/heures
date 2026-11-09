"""Génère le blueprint du scénario Make « KA-RE - Appli heures (API) ».
Lancer : python3 make/build_blueprint.py > make/blueprint.json"""
import json

HOOK = 4501526
CONN = 13987245
CONN_AGENDA = 11414052  # À REMPLACER : cette connexion n'a pas le droit de lire l'agenda (403, 09/11/2026)
AGENDA_ACTIF = False
DB_SAL = "ecbb7b66ed4e4c4eb38d1522db2cb54c"
DB_HEU = "7dd8ae147e89461399009a30d84a30b0"
DB_CON = "595ba62e5d1c40e5a871853f6c3850a8"
DB_PAR = "d5fc072b792e47cca6863eca2116115c"
DB_HEU_D = "7dd8ae14-7e89-4613-9900-9a30d84a30b0"
DB_CON_D = "595ba62e-5d1c-40e5-a871-853f6c3850a8"

PATRON = "3.body.results[1].properties.Profil.select.name = 'Patron'"
MOI = "3.body.results[1].id"
DATE_RE = r"^\d{4}-\d{2}-\d{2}$"
ID_RE = r"^[0-9a-f-]{32,36}$"

HEADERS = [{"key": "Access-Control-Allow-Origin", "value": "*"},
           {"key": "Content-Type", "value": "application/json; charset=utf-8"}]

_y = [0]
def pos(x, y):
    return {"designer": {"x": x, "y": y}}

def notion(mid, x, y, method, url, body, flt=None):
    m = {"id": mid, "module": "notion:makeApiCall", "version": 1,
         "mapper": {"qs": [], "url": url, "method": method,
                    "headers": [{"key": "Content-Type", "value": "application/json"}],
                    "version": "2022-06-28"},
         "metadata": pos(x, y), "parameters": {"__IMTCONN__": CONN}}
    if body is not None:
        m["mapper"]["body"] = body
    if flt:
        m["filter"] = flt
    return m

def tojson(mid, x, y, expr):
    return {"id": mid, "module": "json:TransformToJSON", "version": 1,
            "mapper": {"object": "{{" + expr + "}}"}, "metadata": pos(x, y),
            "parameters": {"space": ""}}

def respond(mid, x, y, body, status=200, flt=None):
    m = {"id": mid, "module": "gateway:WebhookRespond", "version": 1,
         "mapper": {"body": body, "status": status, "headers": HEADERS},
         "metadata": pos(x, y), "parameters": {}}
    if flt:
        m["filter"] = flt
    return m

def cond(a, o, b=None):
    c = {"a": a, "o": o}
    if b is not None:
        c["b"] = b
    return c

def flt(name, *conds):
    return {"name": name, "conditions": [list(conds)]}

USER_OK = cond("{{length(3.body.results)}}", "number:greater", "0")
def act(a):
    return cond("{{2.action}}", "text:equal", a)

# Clause « salarié » ajoutée aux filtres Notion : un salarié ne voit que lui ;
# le patron voit tout, ou un salarié précis s'il en donne l'id.
def clause(prop="Salarié"):
    rel = lambda v: "',{\"property\":\"" + prop + "\",\"relation\":{\"contains\":\"' + " + v + " + '\"}}'"
    return ("{{if(" + PATRON + "; if(length(ifempty(2.salarie_id; '')) = 0; ''; "
            + rel("2.salarie_id") + "); " + rel(MOI) + ")}}")

heures_body = ('{"page_size":100,"sorts":[{"property":"Date","direction":"ascending"}],'
               '"filter":{"and":[{"property":"Date","date":{"on_or_after":"{{2.debut}}"}},'
               '{"property":"Date","date":{"on_or_before":"{{2.fin}}"}}' + clause() + ']}}')
conges_body = ('{"page_size":100,"sorts":[{"property":"Période","direction":"descending"}],'
               '"filter":{"and":[{"property":"Période","date":{"is_not_empty":true}}' + clause() + ']}}')
sal_body = ("{{if(" + PATRON + "; "
            "'{\"page_size\":50,\"filter\":{\"property\":\"Actif\",\"checkbox\":{\"equals\":true}}}'; "
            "'{\"page_size\":1,\"filter\":{\"property\":\"Code accès\",\"rich_text\":{\"equals\":\"' + 2.code + '\"}}}')}}")

DATES_OK = [cond("{{2.debut}}", "text:pattern", DATE_RE), cond("{{2.fin}}", "text:pattern", DATE_RE)]

route_refus = {"flow": [respond(90, 1200, -600,
    '{"ok":false,"m":"Code inconnu"}', 403,
    flt("Code inconnu", cond("{{length(3.body.results)}}", "number:equal", "0")))]}

route_init = {"flow": [
    notion(10, 1200, -300, "POST", f"/v1/databases/{DB_SAL}/query", sal_body,
           flt("Init", USER_OK, act("init"), *DATES_OK)),
    notion(11, 1500, -300, "POST", f"/v1/databases/{DB_PAR}/query", '{"page_size":100}'),
    notion(12, 1800, -300, "POST", f"/v1/databases/{DB_HEU}/query", heures_body),
    notion(13, 2100, -300, "POST", f"/v1/databases/{DB_CON}/query", conges_body),
    tojson(14, 2400, -300, "10.body.results"),
    tojson(15, 2700, -300, "11.body.results"),
    tojson(16, 3000, -300, "12.body.results"),
    tojson(17, 3300, -300, "13.body.results"),
    respond(18, 3600, -300,
        '{"ok":true,"moi_id":"{{3.body.results[1].id}}","salaries":{{14.json}},'
        '"params":{{15.json}},"heures":{{16.json}},"conges":{{17.json}}}'),
]}

route_heures = {"flow": [
    notion(20, 1200, 0, "POST", f"/v1/databases/{DB_HEU}/query", heures_body,
           flt("Heures", USER_OK, act("heures"), *DATES_OK)),
    notion(21, 1500, 0, "POST", f"/v1/databases/{DB_CON}/query", conges_body),
    tojson(22, 1800, 0, "20.body.results"),
    tojson(23, 2100, 0, "21.body.results"),
    respond(24, 2400, 0, '{"ok":true,"heures":{{22.json}},"conges":{{23.json}}}'),
]}

# Création : le parent est écrit APRÈS les propriétés pour qu'un props mal formé
# ne puisse pas rediriger l'écriture vers une autre base.
route_creer = {"flow": [
    notion(30, 1200, 300, "POST", "/v1/pages",
        '{"properties":{{2.props}},"parent":{"database_id":"{{if(2.base = \'conges\'; \'' + DB_CON + "'; '" + DB_HEU + '\')}}"}}',
        flt("Creer", USER_OK, act("ecrire"),
            cond("{{length(ifempty(2.page_id; ''))}}", "number:equal", "0"),
            cond("{{2.base}}", "text:pattern", "^(heures|conges)$"))),
    respond(31, 1500, 300, '{"ok":true,"id":"{{30.body.id}}"}'),
]}

# Modification : on relit la page et on vérifie qu'elle est bien dans Heures ou Congés.
route_modifier = {"flow": [
    notion(40, 1200, 600, "GET", "/v1/pages/{{2.page_id}}", None,
        flt("Modifier", USER_OK, act("ecrire"), cond("{{2.page_id}}", "text:pattern", ID_RE))),
    notion(41, 1500, 600, "PATCH", "/v1/pages/{{2.page_id}}", '{"properties":{{2.props}}}',
        {"name": "Page de l'appli", "conditions": [
            [cond("{{40.body.parent.database_id}}", "text:equal", DB_HEU_D)],
            [cond("{{40.body.parent.database_id}}", "text:equal", DB_CON_D)]]}),
    respond(42, 1800, 600, '{"ok":true,"id":"{{41.body.id}}"}'),
]}

# Agenda du patron (zones de trajet et chantiers) : réservé au profil Patron,
# l'agenda contient les noms et adresses des clients.
route_agenda = {"flow": [
    {"id": 50, "module": "google-calendar:makeApiCall", "version": 5,
     "mapper": {"url": "/v3/calendars/primary/events", "method": "GET", "headers": [], "body": "",
                "qs": [{"key": "timeMin", "value": "{{2.debut}}T00:00:00Z"},
                       {"key": "timeMax", "value": "{{2.fin}}T23:59:59Z"},
                       {"key": "singleEvents", "value": "true"},
                       {"key": "orderBy", "value": "startTime"},
                       {"key": "maxResults", "value": "250"}]},
     "metadata": pos(1200, 900), "parameters": {"__IMTCONN__": CONN_AGENDA},
     "filter": flt("Agenda", USER_OK, act("agenda"), cond("{{3.body.results[1].properties.Profil.select.name}}", "text:equal", "Patron"), *DATES_OK)},
    tojson(51, 1500, 900, "50.body.items"),
    respond(52, 1800, 900, '{"ok":true,"agenda":{{51.json}}}'),
]}

flow = [
    {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "mapper": {},
     "metadata": pos(0, 0), "parameters": {"hook": HOOK, "maxResults": 1}},
    {"id": 2, "module": "json:ParseJSON", "version": 1, "mapper": {"json": "{{1.payload}}"},
     "filter": flt("Corps non vide", cond("{{length(1.payload)}}", "number:greater", "0")),
     "onerror": [{"id": 60, "module": "builtin:Ignore", "version": 1, "metadata": pos(300, 300)}],
     "metadata": pos(300, 0), "parameters": {"type": None}},
    notion(3, 600, 0, "POST", f"/v1/databases/{DB_SAL}/query",
        '{"page_size":1,"filter":{"and":[{"property":"Code accès","rich_text":{"equals":"{{2.code}}"}},'
        '{"property":"Actif","checkbox":{"equals":true}}]}}',
        flt("Code", cond("{{2.code}}", "text:pattern", r"^\d{4}$"))),
    {"id": 4, "module": "builtin:BasicRouter", "version": 1, "mapper": None,
     "metadata": pos(900, 0),
     "routes": [route_refus, route_init, route_heures, route_creer, route_modifier] + ([route_agenda] if AGENDA_ACTIF else [])},
]

bp = {"name": "KA-RE - Appli heures (API)", "flow": flow,
      "metadata": {"instant": True, "version": 1, "designer": {"orphans": []},
                   "scenario": {"dlq": False, "slots": None, "dataloss": False, "maxErrors": 3,
                                "autoCommit": True, "roundtrips": 1, "sequential": False,
                                "confidential": False, "freshVariables": False,
                                "autoCommitTriggerLast": True}}}
print(json.dumps(bp, ensure_ascii=False, indent=1))
