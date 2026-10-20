"""Pyrite demo — run this file with ⌃⇧R (macOS) or Ctrl+Shift+F10 (Windows/Linux)."""
from dataclasses import dataclass


@dataclass
class Crystal:
    name: str
    hardness: float

    def describe(self) -> str:
        return f"{self.name} (Mohs {self.hardness})"


def main() -> None:
    crystals = [Crystal("Pyrite", 6.3), Crystal("Quartz", 7.0)]
    for c in crystals:
        print("✓", c.describe())

    name = input("What's your name? ")
    print(f"Hello, {name}! Click the traceback link below to jump to the bug.")
    divide(1, 0)


def divide(a: int, b: int) -> float:
    return a / b


if __name__ == "__main__":
    main()
