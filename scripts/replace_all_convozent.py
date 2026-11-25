import os
import re

directories = [
    r"D:\autonomous-ai-os\ui",
    r"D:\autonomous-ai-os\frontend",
]

def replace_in_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return False

    original = content

    # 1. URLs
    content = content.replace("https://docs.convozent.ai", "https://docs.autonomous-ai-os.enterprise")
    content = content.replace("https://convozent.ai", "https://autonomous-ai-os.enterprise")
    content = content.replace("docs.convozent.ai", "docs.autonomous-ai-os.enterprise")
    content = content.replace("convozent.ai", "autonomous-ai-os.enterprise")
    content = content.replace("hello@convozent.ai", "support@autonomous-ai-os.enterprise")

    # 2. Specific brand & auth tokens
    content = content.replace("convozent_auth_token", "ai_os_auth_token")
    content = content.replace("convozent_auth_user", "ai_os_auth_user")
    content = content.replace("convozent-inline-container", "ai-os-inline-container")
    content = content.replace("ConvozentWidget", "AIOSWidget")
    content = content.replace("convozent-widget.js", "ai-os-widget.js")
    content = content.replace("CONVOZENT", "AUTONOMOUS_AI_OS")
    content = content.replace("convozent-hq", "autonomous-ai-os")
    content = content.replace("convozent-api", "ai-os-api")
    content = content.replace("convozent-ui", "ai-os-ui")

    # 3. SVGs and text labels
    content = content.replace(">Convozent<", ">Autonomous AI OS<")
    content = content.replace('"Convozent"', '"Autonomous AI OS"')
    content = content.replace("'Convozent'", "'Autonomous AI OS'")
    content = content.replace("Convozent's", "Autonomous AI OS's")
    content = content.replace("Convozent’s", "Autonomous AI OS’s")
    content = content.replace("Convozent&apos;s", "Autonomous AI OS&apos;s")
    content = content.replace("Convozent API", "Autonomous AI OS API")
    content = content.replace("Convozent services", "Autonomous AI OS services")
    content = content.replace("Convozent-managed", "Platform-managed")
    content = content.replace("Convozent Platform", "Autonomous AI OS Platform")
    content = content.replace("Convozent", "Autonomous AI OS")
    content = content.replace("convozent", "autonomous_ai_os")

    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    return False

def run():
    modified_count = 0
    for base in directories:
        for root, dirs, files in os.walk(base):
            if any(skip in root for skip in ["node_modules", ".git", ".next"]):
                continue
            for file in files:
                if file.endswith((".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html", ".svg", ".mts")):
                    p = os.path.join(root, file)
                    if replace_in_file(p):
                        modified_count += 1
                        print(f"Modified: {p}")
    print(f"\nTotal files updated: {modified_count}")

if __name__ == "__main__":
    run()
