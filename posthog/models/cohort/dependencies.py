import logging

from django.core.cache import cache
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from posthog.models.cohort.cohort import Cohort

logger = logging.getLogger(__name__)
DEPENDENCY_CACHE_TIMEOUT = 24 * 60 * 60  # 24 hours
TEAM_CACHE_TIMEOUT = 23 * 60 * 60  # 23 hours - expires before individual entries


def extract_cohort_dependencies(cohort) -> set[int]:
    """
    Extract cohort dependencies from the given cohort.
    """
    dependencies = set()

    for prop in cohort.properties.flat:
        if prop.type == "cohort" and isinstance(prop.value, int):
            dependencies.add(prop.value)

    return dependencies


def get_cohort_dependencies(cohort: Cohort) -> list[int]:
    """
    Get cohorts that this cohort depends on.
    """
    _warm_team_dependency_cache(cohort.team_id)
    cache_key = f"cohort:deps:{cohort.id}"
    return cache.get(cache_key, [])


def get_cohort_dependents(cohort: Cohort) -> list[int]:
    """
    Get cohorts that depend on the given cohort.
    """
    _warm_team_dependency_cache(cohort.team_id)
    cache_key = f"cohort:refs:{cohort.id}"
    return cache.get(cache_key, [])


def _warm_team_dependency_cache(team_id: int) -> None:
    """
    One-time scan to populate dependency cache for all cohorts in a team.
    """
    team_cache_key = f"team:deps_cached:{team_id}"

    # Check if already warm
    if cache.get(team_cache_key):
        return

    logger.info(f"Warming cohort dependency cache for team {team_id}")

    try:
        cohorts = Cohort.objects.filter(team_id=team_id, deleted=False)
        for cohort in cohorts:
            dependencies = extract_cohort_dependencies(cohort)

            cache.set(f"cohort:deps:{cohort.id}", list(dependencies), timeout=DEPENDENCY_CACHE_TIMEOUT)

            # Update reverse dependency indexes
            for dep_id in dependencies:
                refs_key = f"cohort:refs:{dep_id}"
                refs = cache.get(refs_key, [])
                if cohort.id not in refs:
                    refs.append(cohort.id)
                cache.set(refs_key, refs, timeout=DEPENDENCY_CACHE_TIMEOUT)

        # Mark team as cached
        cache.set(team_cache_key, True, timeout=TEAM_CACHE_TIMEOUT)

        logger.info(f"Completed warming cohort dependency cache for team {team_id}, processed {len(cohorts)} cohorts")

    except Exception as e:
        logger.exception(f"Failed to warm cohort dependency cache for team {team_id}", error=e)
        raise


def _clear_team_cache(team_id: int, cohorts) -> None:
    """Clear existing cache entries for a team's cohorts."""
    # Just clear the team cache marker. The other keys will be overwritten the next time the cache is cleared.
    cache.delete(f"team:deps_cached:{team_id}")


@receiver(post_save, sender="posthog.Cohort")
def update_cohort_dependency_cache(sender, instance, **kwargs):
    """
    Updates existing cohort dependency cache entries based on the current state of the cohort.
    """
    team_cache_key = f"team:deps_cached:{instance.team_id}"

    # Only update if team cache is already warmed
    if not cache.get(team_cache_key):
        logger.debug(f"Skipping cache update for cohort {instance.id} - team cache not warmed")
        return

    try:
        old_deps = set(cache.get(f"cohort:deps:{instance.id}", []))
        new_deps = extract_cohort_dependencies(instance)

        # Update forward cache
        cache.set(f"cohort:deps:{instance.id}", list(new_deps), timeout=DEPENDENCY_CACHE_TIMEOUT)

        # Update reverse indexes for removed dependencies
        for dep_id in old_deps - new_deps:
            refs_key = f"cohort:refs:{dep_id}"
            refs = cache.get(refs_key, [])
            if instance.id in refs:
                refs.remove(instance.id)
                cache.set(refs_key, refs, timeout=DEPENDENCY_CACHE_TIMEOUT)

        # Update reverse indexes for added dependencies
        for dep_id in new_deps - old_deps:
            refs_key = f"cohort:refs:{dep_id}"
            refs = cache.get(refs_key, [])
            if instance.id not in refs:
                refs.append(instance.id)
                cache.set(refs_key, refs, timeout=DEPENDENCY_CACHE_TIMEOUT)

        logger.debug(f"Updated dependency cache for cohort {instance.id}")

    except Exception as e:
        # Don't raise - we don't want to break cohort saves due to cache issues
        logger.exception(f"Failed to update dependency cache for cohort {instance.id}", error=e)


@receiver(post_delete, sender="posthog.Cohort")
def clear_cohort_dependency_cache(sender, instance, **kwargs):
    """
    Django signal handler to clean up cache when cohorts are deleted.
    """
    team_cache_key = f"team:deps_cached:{instance.team_id}"

    # Only clean up if team cache is warmed
    if not cache.get(team_cache_key):
        return

    try:
        old_deps = set(cache.get(f"cohort:deps:{instance.id}", []))
        cache.delete(f"cohort:deps:{instance.id}")
        cache.delete(f"cohort:refs:{instance.id}")

        # Clean up reverse indexes
        for dep_id in old_deps:
            refs_key = f"cohort:refs:{dep_id}"
            refs = cache.get(refs_key, [])
            if instance.id in refs:
                refs.remove(instance.id)
                cache.set(refs_key, refs, timeout=DEPENDENCY_CACHE_TIMEOUT)

        logger.debug(f"Cleared dependency cache for deleted cohort {instance.id}")

    except Exception as e:
        logger.exception(f"Failed to clear dependency cache for deleted cohort {instance.id}", error=e)
