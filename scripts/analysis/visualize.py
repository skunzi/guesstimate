#!/usr/bin/env python3
"""
Visualize Guesstimate analytics data exported from Cloudflare D1.

Usage:
    python scripts/analysis/visualize.py <events.csv>
    python scripts/analysis/visualize.py <events.json>
    python scripts/analysis/visualize.py <events.json> --output report.png

Export data from D1 with:
    wrangler d1 execute guessit-analytics --command "SELECT * FROM events" --json > events.json

Or as CSV (if using a D1 console or external tool):
    Supply a CSV with columns matching the events table schema.
"""

import argparse
import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd


def load_data(path: Path) -> pd.DataFrame:
    text = path.read_text()

    if path.suffix == ".json" or text.lstrip().startswith(("[", "{")):
        data = json.loads(text)
        # wrangler d1 execute --json returns a list of result objects
        if isinstance(data, list) and data and "results" in data[0]:
            rows = data[0]["results"]
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            rows = data
        elif isinstance(data, dict) and "results" in data:
            rows = data["results"]
        else:
            print("Error: unrecognized JSON structure", file=sys.stderr)
            sys.exit(1)
        df = pd.DataFrame(rows)
    else:
        df = pd.read_csv(path)

    df["created_at"] = pd.to_datetime(df["created_at"], errors="coerce")
    if "round_date" in df.columns:
        df["round_date"] = pd.to_datetime(df["round_date"], errors="coerce")
    return df


def plot_daily_active_users(ax, df: pd.DataFrame):
    daily = df.groupby(df["created_at"].dt.date)["user_id"].nunique()
    ax.bar(daily.index, daily.values, color="#6366f1", alpha=0.8)
    ax.set_title("Daily Active Users")
    ax.set_xlabel("Date")
    ax.set_ylabel("Unique Users")
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.tick_params(axis="x", rotation=45)


def plot_score_distribution(ax, df: pd.DataFrame):
    guesses = df[df["event_type"] == "guess_submit"]
    if guesses.empty:
        ax.text(0.5, 0.5, "No guess data", ha="center", va="center", transform=ax.transAxes)
        return

    for cat, color in [("how_many", "#f59e0b"), ("how_tall", "#10b981"), ("how_old", "#ef4444")]:
        subset = guesses[guesses["category"] == cat]["score"].dropna()
        if not subset.empty:
            ax.hist(subset, bins=20, alpha=0.6, label=cat, color=color, range=(0, 1000))

    ax.set_title("Score Distribution by Category")
    ax.set_xlabel("Score")
    ax.set_ylabel("Count")
    ax.legend()


def plot_guess_accuracy(ax, df: pd.DataFrame):
    guesses = df[df["event_type"] == "guess_submit"].dropna(subset=["guess", "answer"])
    if guesses.empty:
        ax.text(0.5, 0.5, "No guess data", ha="center", va="center", transform=ax.transAxes)
        return

    error_pct = ((guesses["guess"] - guesses["answer"]) / guesses["answer"] * 100).clip(-200, 200)

    for cat, color in [("how_many", "#f59e0b"), ("how_tall", "#10b981"), ("how_old", "#ef4444")]:
        subset = error_pct[guesses["category"] == cat]
        if not subset.empty:
            ax.hist(subset, bins=40, alpha=0.5, label=cat, color=color)

    ax.axvline(0, color="white", linewidth=0.8, linestyle="--", alpha=0.7)
    ax.set_title("Guess Error Distribution")
    ax.set_xlabel("Error (%)")
    ax.set_ylabel("Count")
    ax.legend()


def plot_time_to_guess(ax, df: pd.DataFrame):
    guesses = df[df["event_type"] == "guess_submit"].dropna(subset=["time_to_guess_ms"])
    if guesses.empty:
        ax.text(0.5, 0.5, "No timing data", ha="center", va="center", transform=ax.transAxes)
        return

    time_sec = guesses["time_to_guess_ms"] / 1000
    ax.hist(time_sec, bins=50, color="#8b5cf6", alpha=0.8, range=(0, min(time_sec.max(), 120)))
    ax.set_title("Time to Guess")
    ax.set_xlabel("Seconds")
    ax.set_ylabel("Count")

    median = time_sec.median()
    ax.axvline(median, color="#fbbf24", linewidth=1.5, linestyle="--", label=f"Median: {median:.1f}s")
    ax.legend()


def plot_completion_rate(ax, df: pd.DataFrame):
    by_round = df[df["round_date"].notna()].groupby("round_date")
    starts = df[df["event_type"] == "game_start"].groupby("round_date")["user_id"].nunique()
    completions = df[df["event_type"] == "game_complete"].groupby("round_date")["user_id"].nunique()

    combined = pd.DataFrame({"starts": starts, "completions": completions}).dropna()
    if combined.empty:
        ax.text(0.5, 0.5, "No completion data", ha="center", va="center", transform=ax.transAxes)
        return

    combined["rate"] = (combined["completions"] / combined["starts"] * 100).clip(0, 100)
    ax.plot(combined.index, combined["rate"], marker="o", markersize=4, color="#06b6d4", linewidth=1.5)
    ax.fill_between(combined.index, combined["rate"], alpha=0.15, color="#06b6d4")
    ax.set_title("Game Completion Rate")
    ax.set_xlabel("Round Date")
    ax.set_ylabel("Completion %")
    ax.set_ylim(0, 105)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.tick_params(axis="x", rotation=45)


def plot_total_scores(ax, df: pd.DataFrame):
    completed = df[df["event_type"] == "game_complete"].dropna(subset=["total_score"])
    if completed.empty:
        ax.text(0.5, 0.5, "No completion data", ha="center", va="center", transform=ax.transAxes)
        return

    ax.hist(completed["total_score"], bins=20, color="#ec4899", alpha=0.8, range=(0, 4000))
    ax.set_title("Total Score Distribution (per Round)")
    ax.set_xlabel("Total Score (max 4000)")
    ax.set_ylabel("Count")

    mean = completed["total_score"].mean()
    ax.axvline(mean, color="#fbbf24", linewidth=1.5, linestyle="--", label=f"Mean: {mean:.0f}")
    ax.legend()


def plot_photo_difficulty(ax, df: pd.DataFrame):
    guesses = df[df["event_type"] == "guess_submit"].dropna(subset=["photo_index", "score"])
    if guesses.empty:
        ax.text(0.5, 0.5, "No guess data", ha="center", va="center", transform=ax.transAxes)
        return

    by_photo = guesses.groupby("photo_index")["score"].agg(["mean", "std"])
    photos = by_photo.index.astype(int)
    ax.bar(photos, by_photo["mean"], yerr=by_photo["std"], color="#14b8a6", alpha=0.8,
           capsize=4, error_kw={"linewidth": 1.2})
    ax.set_title("Average Score by Photo Position")
    ax.set_xlabel("Photo #")
    ax.set_ylabel("Avg Score")
    ax.set_xticks(range(4))
    ax.set_xticklabels(["Photo 1", "Photo 2", "Photo 3", "Photo 4"])
    ax.set_ylim(0, 1050)


def plot_user_retention(ax, df: pd.DataFrame):
    user_days = df.groupby("user_id")["created_at"].agg(["min", "max"])
    user_days["days_active"] = (user_days["max"] - user_days["min"]).dt.days

    completed_per_user = df[df["event_type"] == "game_complete"].groupby("user_id").size()
    if completed_per_user.empty:
        ax.text(0.5, 0.5, "No retention data", ha="center", va="center", transform=ax.transAxes)
        return

    ax.hist(completed_per_user.values, bins=range(0, min(completed_per_user.max() + 2, 50)),
            color="#f97316", alpha=0.8)
    ax.set_title("Rounds Completed per User")
    ax.set_xlabel("Rounds Completed")
    ax.set_ylabel("Number of Users")


def print_summary(df: pd.DataFrame):
    print("\n=== Analytics Summary ===")
    print(f"Total events: {len(df):,}")
    print(f"Unique users: {df['user_id'].nunique():,}")
    print(f"Date range: {df['created_at'].min():%Y-%m-%d} to {df['created_at'].max():%Y-%m-%d}")
    print()

    for event_type in ["game_start", "guess_submit", "game_complete", "progress_reset"]:
        count = (df["event_type"] == event_type).sum()
        print(f"  {event_type}: {count:,}")

    completed = df[df["event_type"] == "game_complete"]
    if not completed.empty and "total_score" in completed.columns:
        scores = completed["total_score"].dropna()
        if not scores.empty:
            print(f"\nScore stats (total per round):")
            print(f"  Mean: {scores.mean():.0f} / 4000")
            print(f"  Median: {scores.median():.0f} / 4000")
            print(f"  Std: {scores.std():.0f}")


def main():
    parser = argparse.ArgumentParser(description="Visualize Guesstimate analytics data")
    parser.add_argument("csv_file", type=Path, help="Path to exported events CSV")
    parser.add_argument("--output", "-o", type=Path, default=None,
                        help="Save figure to file instead of displaying")
    args = parser.parse_args()

    if not args.csv_file.exists():
        print(f"Error: {args.csv_file} not found", file=sys.stderr)
        sys.exit(1)

    df = load_data(args.csv_file)
    print_summary(df)

    plt.style.use("dark_background")
    fig, axes = plt.subplots(2, 4, figsize=(20, 10))
    fig.suptitle("Guesstimate Analytics Dashboard", fontsize=16, fontweight="bold", y=0.98)

    plot_daily_active_users(axes[0, 0], df)
    plot_score_distribution(axes[0, 1], df)
    plot_guess_accuracy(axes[0, 2], df)
    plot_time_to_guess(axes[0, 3], df)
    plot_completion_rate(axes[1, 0], df)
    plot_total_scores(axes[1, 1], df)
    plot_photo_difficulty(axes[1, 2], df)
    plot_user_retention(axes[1, 3], df)

    plt.tight_layout(rect=[0, 0, 1, 0.96])

    if args.output:
        fig.savefig(args.output, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
        print(f"\nSaved to {args.output}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
