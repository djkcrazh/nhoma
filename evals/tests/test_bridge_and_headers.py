"""Tests that call the real TypeScript importer through the bridge."""
import pytest

from nhoma_evals.bridge import BridgeError, run_batched, run_ops
from nhoma_evals.styles import SEEN_HEADERS, UNSEEN_HEADERS


def test_read_decodes_and_parses_like_the_upload_screen():
    raw = "Pig No,Sex\r\nA-1,Sow\r\n\r\nA-2,Boar\r\n".encode("utf-8-sig")        # BOM + a blank line
    out = run_ops([{"id": "r", "op": "read", "bytesHex": raw.hex()}])["r"]
    assert out["encoding"] == "utf-8"
    assert out["headers"] == ["Pig No", "Sex"]                                   # the BOM did not corrupt the first header
    assert out["records"] == [{"Pig No": "A-1", "Sex": "Sow"}, {"Pig No": "A-2", "Sex": "Boar"}]


def test_one_bad_op_does_not_sink_the_batch():
    res = run_ops([{"id": "bad", "op": "apply", "mapping": {"nonsense": True}, "records": []}, {"id": "ok", "op": "default"}])
    assert res["bad"]["schemaOk"] is False and res["bad"]["schemaErrors"]       # invalid shape is reported, not crashed on
    assert "mapping" in res["ok"]


def test_duplicate_ids_are_rejected_before_calling_node():
    with pytest.raises(ValueError):
        run_ops([{"id": "x", "op": "default"}, {"id": "x", "op": "default"}])


def test_a_crash_of_the_whole_bridge_surfaces_as_a_bridge_error(monkeypatch):
    import nhoma_evals.bridge as bridge
    monkeypatch.setattr(bridge, "BRIDGE", bridge.REPO_ROOT / "scripts" / "does-not-exist.ts")
    with pytest.raises(BridgeError):
        bridge.run_ops([{"id": "x", "op": "default"}])


def test_check_flags_a_mapping_that_uses_a_made_up_column():
    mapping = run_ops([{"id": "d", "op": "default"}])["d"]["mapping"]           # expects Nhoma's own column names
    res = run_ops([{"id": "c", "op": "check", "mapping": mapping, "records": [{"Pig No": "A"}], "headers": ["Pig No"]}])["c"]
    kinds = {(p["kind"], p.get("field")) for p in res["problems"]}
    assert ("unknownColumn", "tagId") in kinds


def _suggest_each(pool):
    ops, meta = [], {}
    for key, headers in pool.items():
        for h in headers:
            oid = f"{key}|{h}"
            ops.append({"id": oid, "op": "suggest", "headers": [h], "records": [{h: "x"}]})
            meta[oid] = ("weightKg" if key.startswith("weight") else key, h)
    res = run_batched(ops)
    return {oid: {f: (v or {}).get("source") for f, v in res[oid]["mapping"]["fields"].items() if (v or {}).get("source")} for oid in meta}, meta


def test_every_SEEN_header_really_is_recognised_by_the_baseline():
    mapped, meta = _suggest_each(SEEN_HEADERS)
    wrong = [h for oid, (field, h) in meta.items() if mapped[oid].get(field) != h]
    assert not wrong, f"labelled SEEN but not recognised: {wrong}. Move them to UNSEEN_HEADERS."


def test_every_UNSEEN_header_really_is_NOT_recognised_by_the_baseline():
    mapped, meta = _suggest_each(UNSEEN_HEADERS)
    taught = [h for oid, (field, h) in meta.items() if mapped[oid]]
    assert not taught, f"the baseline now recognises {taught}. Move them to SEEN_HEADERS and add fresh unseen headers."
