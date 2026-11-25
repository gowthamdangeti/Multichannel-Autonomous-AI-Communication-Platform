import os
import re

directories = [
    r"D:\autonomous-ai-os\ui",
    r"D:\autonomous-ai-os\frontend",
]

def scan():
    results = {}
    for base in directories:
        for root, dirs, files in os.walk(base):
            if any(skip in root for skip in ["node_modules", ".git", ".next"]):
                continue
            for file in files:
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        lines = f.readlines()
                    matching_lines = [
                        (i + 1, line.strip())
                        for i, line in enumerate(lines)
                        if re.search(r"convozent", line, re.IGNORECASE)
                    ]
                    if matching_lines:
                        results[filepath] = matching_lines
                except Exception as e:
                    pass
    return results

if __name__ == "__main__":
    matches = scan()
    print(f"Files with 'convozent': {len(matches)}")
    for file, lines in list(matches.items())[:30]:
        print(f"\n--- {file} ({len(lines)} matches) ---")
        for num, line in lines[:5]:
            print(f"  {num}: {line[:120]}")
