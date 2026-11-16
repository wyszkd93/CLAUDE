"""예시 페르소나가 스키마를 통과하고, 잘못된 입력은 거부되는지 검사한다. 사용: python3 -I scripts/check_schema.py"""
import copy, json, pathlib, sys
from jsonschema import Draft202012Validator as V

root = pathlib.Path(__file__).resolve().parent.parent
schema = json.loads((root / "schema/persona.schema.json").read_text(encoding="utf-8"))
V.check_schema(schema)
v = V(schema)
bad_cases = {
    "no safety": lambda q: q.pop("safety"),
    "bad id": lambda q: q.__setitem__("id", "Bad Id"),
    "bad mood": lambda q: q["flair"]["lead"].__setitem__("sleepy", ["z"]),
    "extra key": lambda q: q.__setitem__("foo", 1),
    "empty invariants": lambda q: q["safety"].__setitem__("invariants", []),
}
fail = 0
for f in sorted((root / "examples").glob("*.persona.json")):
    p = json.loads(f.read_text(encoding="utf-8"))
    errs = [e.message for e in v.iter_errors(p)]
    print(f.name, "OK" if not errs else errs)
    fail += bool(errs)
    for name, mut in bad_cases.items():
        q = copy.deepcopy(p); mut(q)
        if not list(v.iter_errors(q)):
            print("  거부돼야 하는데 통과:", name); fail += 1
sys.exit(1 if fail else 0)
