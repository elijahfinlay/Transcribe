#!/usr/bin/env python3
"""Fetch YouTube transcript and output as JSON."""
import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Video ID required"}))
        sys.exit(1)

    video_id = sys.argv[1]

    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id)

        snippets = [
            {
                "text": s.text.replace("\n", " "),
                "start": s.start,
                "duration": s.duration,
            }
            for s in transcript.snippets
        ]

        print(
            json.dumps(
                {
                    "videoId": video_id,
                    "language": transcript.language_code,
                    "snippets": snippets,
                }
            )
        )
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
