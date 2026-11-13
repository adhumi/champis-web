"""web/comprendre.js : le rendu du Guide (liste des articles, liste et fiche des espèces), fonctions
pures exécutées par node (sauté sans node).

Ce qui vient de l'API ou du référentiel n'est jamais du HTML : un identifiant ou une adresse
hostile ne sort ni d'un attribut ni d'une balise, et seul un `https://` devient un lien.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

HERE = Path(__file__).parent
DRIVER = HERE / "comprendre_driver.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")

HOSTILE_ID = "\"><img src=x onerror=alert(1)>'&x=<script>"
ABOUT = {
    "summary": "Un cèpe.",
    "habitat": "Sous les chênes.",
    "season": "Été et automne.",
    "confusions": [
        {"name": "Bolet <amer>", "latin": "Tylopilus felleus", "risk": "r", "tell": "t"}
    ],
    "references": {"a": "Une <source>"},
}


def call(*calls: tuple[str, list]) -> list:
    payload = json.dumps([{"fn": fn, "args": args} for fn, args in calls])
    proc = subprocess.run(
        ["node", str(DRIVER)], input=payload, capture_output=True, text=True, check=True
    )
    out = json.loads(proc.stdout)
    for item in out:
        assert "error" not in item, item
    return [item["value"] for item in out]


class Tags(HTMLParser):
    """Balises et attributs d'un fragment, tels qu'un navigateur les lirait."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append((tag, dict(attrs)))


def tags(html: str) -> list[tuple[str, dict[str, str | None]]]:
    parser = Tags()
    parser.feed(html)
    return parser.tags


def assert_inert(html: str) -> None:
    """Aucune balise active ni gestionnaire d'événement, aucun lien hors du site ou de https."""
    for tag, attrs in tags(html):
        assert tag not in {"script", "iframe", "object", "embed", "svg", "style"}, (tag, html)
        assert not [a for a in attrs if a.startswith("on")], (tag, attrs)
        if tag == "a":
            assert re.match(r"^(comprendre\.html(\?|$)|https://)", attrs["href"]), attrs


def species(sid: str, **about) -> dict:
    return {
        "id": sid,
        "names": {"fr": "Cèpe <b>de</b> Bordeaux", "la": "Boletus edulis"},
        "group": {"id": "cepes", "fr": "Cèpes"},
        "about": {**ABOUT, **about},
    }


def test_articles_nav_escapes_the_identifier():
    (html,) = call(
        (
            "articlesNav",
            [
                [
                    {"id": "comment-ca-marche", "title": "Comment ça marche"},
                    {"id": HOSTILE_ID, "title": "<b>Titre</b>"},
                ],
                "comment-ca-marche",
            ],
        )
    )
    assert_inert(html)
    links = [attrs for tag, attrs in tags(html) if tag == "a"]
    assert [tag for tag, _ in tags(html)] == ["a", "a"]
    assert links[0] == {
        "href": "comprendre.html?article=comment-ca-marche",
        "aria-current": "page",
    }
    assert links[1]["href"].startswith("comprendre.html?article=%22%3E%3Cimg")
    assert "&lt;b&gt;Titre&lt;/b&gt;" in html


def test_species_list_escapes_a_hostile_identifier():
    (html,) = call(
        (
            "speciesList",
            [{"x": species(HOSTILE_ID), "boletus_edulis": species("boletus_edulis")}],
        )
    )
    assert_inert(html)
    assert [tag for tag, _ in tags(html)] == ["h2", "ul", "li", "a", "em", "li", "a", "em"]
    hrefs = [attrs["href"] for tag, attrs in tags(html) if tag == "a"]
    assert "comprendre.html?article=especes&espece=boletus_edulis" in hrefs
    hostile = next(h for h in hrefs if "boletus_edulis" not in h)
    # l'identifiant reste dans la valeur de `espece` : ni guillemet, ni chevron, ni second paramètre
    assert re.fullmatch(r"comprendre\.html\?article=especes&espece=[A-Za-z0-9%_.!'()*~-]+", hostile)
    assert "%22%3E%3Cimg" in hostile and "%26x%3D" in hostile
    assert "<b>" not in html


def test_species_list_without_catalogue():
    (html,) = call(("speciesList", [None]))
    assert "Les fiches arrivent" in html


@pytest.mark.parametrize(
    "page",
    [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        " https://commons.wikimedia.org/wiki/File:X.jpg",
        "http://commons.wikimedia.org/wiki/File:X.jpg",
        "//evil.test/x",
        "data:text/html,<script>alert(1)</script>",
        '"><script>alert(1)</script>',
        None,
        42,
    ],
)
def test_species_sheet_never_links_a_photo_page_that_is_not_https(page):
    photo = {"url": "https://x.test/a.jpg", "page": page, "author": "A <i>", "license": "CC BY"}
    (html,) = call(("speciesSheet", [species("boletus_edulis", photo=photo)]))
    assert_inert(html)
    assert [attrs["href"] for tag, attrs in tags(html) if tag == "a"] == [
        "comprendre.html?article=especes"
    ]
    # le crédit reste, en texte
    assert "A &lt;i&gt; · CC BY · Wikimedia Commons" in html


def test_species_sheet_links_an_https_photo_page_and_escapes_everything():
    photo = {
        "url": "https://x.test/a.jpg",
        "page": 'https://commons.wikimedia.org/wiki/File:X.jpg?a=1&b="2"',
        "author": "Auteur",
        "license": "CC BY-SA 4.0",
    }
    (html,) = call(("speciesSheet", [species(HOSTILE_ID, photo=photo)]))
    assert_inert(html)
    credit = [attrs for tag, attrs in tags(html) if tag == "a"][1]
    assert credit == {"href": photo["page"], "rel": "noopener"}
    assert "Auteur · CC BY-SA 4.0 · Wikimedia Commons" in html
    assert "Cèpe &lt;b&gt;de&lt;/b&gt; Bordeaux" in html
    assert "Bolet &lt;amer&gt;" in html and "Une &lt;source&gt;" in html
    assert "<script" not in html and "<b>" not in html


def test_species_sheet_without_about_or_photo():
    bare, no_photo = call(
        ("speciesSheet", [{"id": "boletus_edulis", "names": {"fr": "Cèpe", "la": "B."}}]),
        ("speciesSheet", [species("boletus_edulis")]),
    )
    assert "Fiche à venir." in bare
    assert "Photo à venir" in no_photo and "<img" not in no_photo
