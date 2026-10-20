from main import Crystal


def test_describe():
    assert Crystal("Pyrite", 6.3).describe() == "Pyrite (Mohs 6.3)"
