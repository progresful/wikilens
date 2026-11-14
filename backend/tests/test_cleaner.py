from wikilens.blocks import Block
from wikilens.cleaner import clean


def pairs(wikitext):
    return [(b.kind, b.text) for b in clean(wikitext)]


def test_kinds():
    assert pairs("== Tausta ==\nEka kappale.\n* kohta\n") == [("h", "Tausta"), ("p", "Eka kappale."), ("li", "kohta")]


def test_templates_refs_links_and_emphasis_removed():
    text = "{{Infobox|a=b}}Sota alkoi<ref>lähde</ref> [[Suomi|Suomessa]] ''vuonna'' 1939."
    assert pairs(text) == [("p", "Sota alkoi Suomessa vuonna 1939.")]


def test_nested_template_removed():
    assert pairs("Alku {{a|{{b}}|c}} loppu.") == [("p", "Alku  loppu.")]


def test_unclosed_template_keeps_rest_of_page():
    assert pairs("Alku.\n{{rikki|x\nLoppu säilyy.") == [("p", "Alku."), ("p", "{{rikki|x"), ("p", "Loppu säilyy.")]


def test_closed_template_inside_an_unclosed_one_is_still_removed():
    assert pairs("{{rikki Alku {{a|b}} loppu.") == [("p", "{{rikki Alku  loppu.")]


def test_unclosed_table_keeps_rest_of_page():
    assert pairs("Alku.\n{| class=x\nLoppu.")[-1] == ("p", "Loppu.")


def test_empty_and_whitespace():
    assert clean("") == []
    assert clean("  \n\n") == []


def test_redirect_yields_no_blocks():
    assert clean("#OHJAUS [[Talvisota]]") == []
    assert clean("#redirect [[Talvisota]]") == []
    assert clean("  #UUDELLEENOHJAUS [[Talvisota]]") == []


def test_hash_depends_on_kind_and_text():
    a = Block.of("p", "a")
    assert len(a.hash) == 16
    assert a.hash == Block.of("p", "a").hash
    assert a.hash != Block.of("li", "a").hash
    assert a.hash != Block.of("p", "b").hash


def test_html_entities_are_decoded():
    assert pairs("Tappiot olivat 22&nbsp;800 kaatunutta &ndash; arvio &amp; lähde.") == [
        ("p", "Tappiot olivat 22 800 kaatunutta – arvio & lähde.")
    ]


def test_escaped_markup_stays_text():
    assert pairs("Kirjoita &lt;b&gt;lihavoitu&lt;/b&gt; näin.") == [("p", "Kirjoita <b>lihavoitu</b> näin.")]
