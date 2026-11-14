from wikilens.positions import assign_positions


def test_between_anchors():
    assert assign_positions([1.0, None, 2.0]) == ([1.0, 1.5, 2.0], False)


def test_two_between():
    assert assign_positions([1.0, None, None, 4.0]) == ([1.0, 2.0, 3.0, 4.0], False)


def test_no_anchors():
    assert assign_positions([None, None]) == ([1.0, 2.0], False)


def test_before_first():
    assert assign_positions([None, 5.0]) == ([4.0, 5.0], False)


def test_after_last():
    assert assign_positions([5.0, None, None]) == ([5.0, 6.0, 7.0], False)


def test_exhausted_gap_renumbers():
    assert assign_positions([1.0, None, 1.0000000001]) == ([1.0, 2.0, 3.0], True)


def test_empty():
    assert assign_positions([]) == ([], False)
