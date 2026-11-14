from wikilens.blocks import Block
from wikilens.matcher import Memory, Rule, carry_forward, match_revision

A = "Talvisota alkoi 30. marraskuuta 1939."
B = "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi."


def P(*texts):
    return [Block.of("p", t) for t in texts]


def ids(state):
    return [p.para_id for p in state.paras]


def run(*revs):
    """revs: (blocks, sha1) per revision. Returns the state after each."""
    states, prev, memory = [], None, Memory()
    for i, (blocks, sha1) in enumerate(revs):
        prev, memory = match_revision(prev, blocks, 100 + i, sha1, memory, i)
        states.append(prev)
    return states


def test_first_revision_all_new():
    (s,) = run((P("a", "b"), "s1"))
    assert ids(s) == [1, 2]
    assert {p.rule for p in s.paras} == {Rule.NEW}
    assert s.rev_id == 100


def test_unchanged_keeps_identity_and_position():
    s1, s2 = run((P("a", "b"), "s1"), (P("a", "b"), "s2"))
    assert ids(s2) == [1, 2]
    assert [p.pos for p in s2.paras] == [p.pos for p in s1.paras]
    assert s2.paras[0].rule == Rule.UNCHANGED


def test_edit_keeps_identity():
    _, s2 = run((P(A, "b"), "s1"), (P(B, "b"), "s2"))
    assert ids(s2) == [1, 2]
    assert s2.paras[0].rule == Rule.EDITED
    assert 0.5 <= s2.paras[0].similarity < 1


def test_dissimilar_replacement_is_a_new_identity():
    _, s2 = run((P("aaaa aaaa aaaa", "b"), "s1"), (P("zzzz qqqq xxxx", "b"), "s2"))
    assert ids(s2) == [3, 2]
    assert s2.paras[0].rule == Rule.NEW


def test_move():
    _, s2 = run((P("a", "b", "c"), "s1"), (P("c", "a", "b"), "s2"))
    pos = [p.pos for p in s2.paras]
    assert ids(s2) == [3, 1, 2]
    assert s2.paras[0].rule == Rule.MOVED
    assert pos == sorted(pos) and len(set(pos)) == 3


def test_insert_does_not_touch_neighbours():
    s1, s2 = run((P("a", "c"), "s1"), (P("a", "b", "c"), "s2"))
    assert (s2.paras[0].pos, s2.paras[2].pos) == (s1.paras[0].pos, s1.paras[1].pos)
    assert s2.paras[0].pos < s2.paras[1].pos < s2.paras[2].pos


def test_remove_then_restore_by_hash_reuses_identity():
    *_, s3 = run((P("a", "b"), "s1"), (P("a"), "s2"), (P("a", "b", "c"), "s3"))
    assert ids(s3) == [1, 2, 3]
    assert s3.paras[1].rule == Rule.RESTORED


def test_restore_reworded_within_window():
    *_, s3 = run((P("a", A), "s1"), (P("a"), "s2"), (P("a", B, "c"), "s3"))
    assert ids(s3)[1] == 2
    assert s3.paras[1].rule == Rule.RESTORED
    assert s3.paras[1].similarity >= 0.6


def test_reworded_restore_outside_the_window_is_new():
    filler = [(P("a"), f"f{i}") for i in range(25)]
    *_, last = run((P("a", A), "s1"), (P("a"), "s2"), *filler, (P("a", B), "s3"))
    assert ids(last)[1] == 3
    assert last.paras[1].rule == Rule.NEW


def test_full_revert_restores_the_exact_map():
    s1, _, s3 = run((P("x", "y", "z"), "A"), (P("lol"), "B"), (P("x", "y", "z"), "A"))
    assert [(p.para_id, p.pos, p.block) for p in s3.paras] == [(p.para_id, p.pos, p.block) for p in s1.paras]
    assert {p.rule for p in s3.paras} == {Rule.REVERT}


def test_same_sha1_with_different_blocks_is_not_trusted():
    _, s2 = run((P("x", "y"), "A"), (P("x", "q"), "A"))
    assert [p.block.text for p in s2.paras] == ["x", "q"]


def test_duplicate_blocks_keep_separate_identities():
    s1, s2 = run((P("sama", "sama"), "s1"), (P("sama", "uusi", "sama"), "s2"))
    assert ids(s1) == [1, 2]
    assert (ids(s2)[0], ids(s2)[2]) == (1, 2)


def test_kind_mismatch_is_not_an_edit():
    _, s2 = run(([Block.of("p", A)], "s1"), ([Block.of("h", A)], "s2"))
    assert ids(s2) == [2]


def test_zero_blocks_ends_everything_and_revert_brings_it_back():
    _, s2, s3 = run((P("a", "b"), "A"), ([], "B"), (P("a", "b"), "A"))
    assert s2.paras == ()
    assert ids(s3) == [1, 2]


def test_carry_forward_marks_missing_text():
    (s1,) = run((P("a"), "s1"))
    s2 = carry_forward(s1, 999)
    assert s2.paras == s1.paras
    assert s2.text_missing
    assert s2.rev_id == 999


def test_carry_forward_before_any_revision():
    s = carry_forward(None, 5)
    assert s.paras == () and s.text_missing


def test_memory_passed_in_is_not_altered():
    memory = Memory()
    match_revision(None, P("a"), 1, "s1", memory, 0)
    assert memory == Memory()
