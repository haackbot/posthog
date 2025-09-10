import { actions, kea, key, path, props, reducers, selectors } from 'kea'

import { dayjs } from 'lib/dayjs'
import {
    getDefaultInterval,
    isValidRelativeOrAbsoluteDate,
    updateDatesWithInterval,
    dateMapping,
    formatDateRange,
    DATE_FORMAT,
    dateStringToDayJs,
} from 'lib/utils'
import { DateMappingOption } from '~/types'

import { NodeKind } from '~/queries/schema/schema-general'
import { ChartDisplayType, InsightLogicProps, IntervalType } from '~/types'

import { EmbeddedAnalyticsTileId, EmbeddedQueryTile } from './common'
import type { embeddedAnalyticsLogicType } from './embeddedAnalyticsLogicType'

const INITIAL_DATE_FROM = '-7d' as string
const INITIAL_DATE_TO = null as string | null
const INITIAL_INTERVAL = getDefaultInterval(INITIAL_DATE_FROM, INITIAL_DATE_TO)

export const EMBEDDED_ANALYTICS_DATA_COLLECTION_NODE_ID = 'EmbeddedAnalyticsScene'

export interface EmbeddedAnalyticsLogicProps {
    dashboardId?: string | number
}

export const embeddedAnalyticsLogic = kea<embeddedAnalyticsLogicType>([
    path(['scenes', 'embedded-analytics', 'embeddedAnalyticsLogic']),
    props({} as EmbeddedAnalyticsLogicProps),
    key(({ dashboardId }) => dashboardId || 'default'),
    
    actions({
        setDates: (dateFrom: string | null, dateTo: string | null) => ({ dateFrom, dateTo }),
        setInterval: (interval: IntervalType) => ({ interval }),
        setDatesAndInterval: (dateFrom: string | null, dateTo: string | null, interval?: IntervalType) => ({ 
            dateFrom, 
            dateTo, 
            interval 
        }),
        setRequestNameBreakdownEnabled: (enabled: boolean) => ({ enabled }),
    }),
    
    reducers({
        dateFilter: [
            {
                dateFrom: INITIAL_DATE_FROM,
                dateTo: INITIAL_DATE_TO,
                interval: INITIAL_INTERVAL,
            } as { dateFrom: string | null; dateTo: string | null; interval: IntervalType },
            {
                setDates: (_, { dateTo, dateFrom }) => {
                    if (dateTo && !isValidRelativeOrAbsoluteDate(dateTo)) {
                        dateTo = INITIAL_DATE_TO
                    }
                    if (dateFrom && !isValidRelativeOrAbsoluteDate(dateFrom)) {
                        dateFrom = INITIAL_DATE_FROM
                    }
                    return {
                        dateTo,
                        dateFrom: dateFrom || INITIAL_DATE_FROM,
                        interval: getDefaultInterval(dateFrom, dateTo),
                    }
                },
                setInterval: ({ dateFrom: oldDateFrom, dateTo: oldDateTo }, { interval }) => {
                    const { dateFrom, dateTo } = updateDatesWithInterval(interval, oldDateFrom, oldDateTo)
                    return {
                        dateTo,
                        dateFrom: dateFrom || INITIAL_DATE_FROM,
                        interval,
                    }
                },
                setDatesAndInterval: (_, { dateTo, dateFrom, interval }) => {
                    if (!dateFrom && !dateTo) {
                        dateFrom = INITIAL_DATE_FROM
                        dateTo = INITIAL_DATE_TO
                    }
                    if (dateTo && !isValidRelativeOrAbsoluteDate(dateTo)) {
                        dateTo = INITIAL_DATE_TO
                    }
                    if (dateFrom && !isValidRelativeOrAbsoluteDate(dateFrom)) {
                        dateFrom = INITIAL_DATE_FROM
                    }
                    return {
                        dateTo,
                        dateFrom: dateFrom || INITIAL_DATE_FROM,
                        interval: interval || getDefaultInterval(dateFrom, dateTo),
                    }
                },
            },
        ],
        requestNameBreakdownEnabled: [
            false,
            {
                setRequestNameBreakdownEnabled: (_, { enabled }) => enabled,
            },
        ],
    }),

    selectors({
        tiles: [
            (s) => [s.dateFilter, s.requestNameBreakdownEnabled],
            (dateFilter, requestNameBreakdownEnabled): EmbeddedQueryTile[] => {
                const dateFromDayjs = dateStringToDayJs(dateFilter.dateFrom)
                const dateToDayjs = dateFilter.dateTo ? dateStringToDayJs(dateFilter.dateTo) : null
                
                const dateFrom = dateFromDayjs 
                    ? dateFromDayjs.format('YYYY-MM-DD')
                    : dayjs().subtract(7, 'day').format('YYYY-MM-DD')
                    
                const dateTo = dateToDayjs 
                    ? dateToDayjs.format('YYYY-MM-DD')
                    : dayjs().format('YYYY-MM-DD')
                
                return [
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_QUERIES_COUNT,
                        title: 'Number of queries per day',
                        layout: {
                            colSpanClassName: 'md:col-span-2',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: requestNameBreakdownEnabled
                                    ? `select event_date, name, count(1) as number_of_queries
                                        from query_log
                                        where is_personal_api_key_request 
                                        and event_date >= '${dateFrom}' 
                                        and event_date <= '${dateTo}'
                                        group by event_date, name
                                        order by event_date asc, name asc`
                                    : `select event_date, count(1) as number_of_queries
                                        from query_log
                                        where is_personal_api_key_request 
                                        and event_date >= '${dateFrom}' 
                                        and event_date <= '${dateTo}'
                                        group by event_date
                                        order by event_date asc`,
                            },
                            display: ChartDisplayType.ActionsStackedBar,
                            chartSettings: {
                                xAxis: { column: 'event_date' },
                                yAxis: [
                                    {
                                        column: 'number_of_queries',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                showLegend: true,
                                seriesBreakdownColumn: requestNameBreakdownEnabled ? 'name' : null,
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_api_queries',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_READ_TB,
                        title: 'Read TB per day',
                        layout: {
                            colSpanClassName: 'md:col-span-2',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: requestNameBreakdownEnabled
                                    ? `select 
                                            event_date, 
                                            name,
                                            sum(read_bytes)/1e12 as read_tb
                                        from query_log
                                        where 
                                            is_personal_api_key_request 
                                            and event_date >= '${dateFrom}' 
                                            and event_date <= '${dateTo}'
                                        group by event_date, name
                                        order by event_date asc, name asc`
                                    : `select 
                                            event_date, 
                                            sum(read_bytes)/1e12 as read_tb
                                        from query_log
                                        where 
                                            is_personal_api_key_request 
                                            and event_date >= '${dateFrom}' 
                                            and event_date <= '${dateTo}'
                                        group by event_date
                                        order by event_date asc`,
                            },
                            display: ChartDisplayType.ActionsBar,
                            chartSettings: {
                                xAxis: { column: 'event_date' },
                                yAxis: [
                                    {
                                        column: 'read_tb',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                showLegend: true,
                                seriesBreakdownColumn: requestNameBreakdownEnabled ? 'name' : null,
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_read_tb',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_CPU_SECONDS,
                        title: 'Used CPU seconds per day',
                        layout: {
                            colSpanClassName: 'md:col-span-2',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: requestNameBreakdownEnabled
                                    ? `select 
                                            event_date, 
                                            name,
                                            sum(cpu_microseconds)/1e6 as cpu_sec
                                        from query_log
                                        where 
                                            is_personal_api_key_request 
                                            and event_date >= '${dateFrom}' 
                                            and event_date <= '${dateTo}'
                                        group by event_date, name
                                        order by event_date asc, name asc`
                                    : `select 
                                            event_date, 
                                            sum(cpu_microseconds)/1e6 as cpu_sec
                                        from query_log
                                        where 
                                            is_personal_api_key_request 
                                            and event_date >= '${dateFrom}' 
                                            and event_date <= '${dateTo}'
                                        group by event_date
                                        order by event_date asc`,
                            },
                            display: ChartDisplayType.ActionsLineGraph,
                            chartSettings: {
                                xAxis: { column: 'event_date' },
                                yAxis: [
                                    {
                                        column: 'cpu_sec',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                showLegend: true,
                                seriesBreakdownColumn: requestNameBreakdownEnabled ? 'name' : null,
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_cpu_sec',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_QUERIES_PER_KEY,
                        title: 'Number of queries per personal api key',
                        layout: {
                            colSpanClassName: 'md:col-span-2',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: `select event_date, api_key_label, count(1) as total_queries
                                        from query_log 
                                        where event_date >= '${dateFrom}'
                                            and event_date <= '${dateTo}'
                                            and is_personal_api_key_request
                                        group by event_date, api_key_label
                                        order by event_date`,
                            },
                            display: ChartDisplayType.ActionsLineGraph,
                            chartSettings: {
                                xAxis: { column: 'event_date' },
                                yAxis: [
                                    {
                                        column: 'total_queries',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                showLegend: true,
                                seriesBreakdownColumn: 'api_key_label',
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_queries_per_key',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_LAST_20_QUERIES,
                        title: 'Last 20 queries',
                        layout: {
                            colSpanClassName: 'md:col-span-full',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: requestNameBreakdownEnabled
                                    ? `select event_time as finished_at, name, query_duration_ms, query, created_by 
                                        from query_log
                                        where is_personal_api_key_request
                                            and event_date >= '${dateFrom}'
                                            and event_date <= '${dateTo}'
                                        order by event_time desc
                                        limit 20`
                                    : `select event_time as finished_at, query_duration_ms, query, created_by 
                                        from query_log
                                        where is_personal_api_key_request
                                            and event_date >= '${dateFrom}'
                                            and event_date <= '${dateTo}'
                                        order by event_time desc
                                        limit 20`,
                            },
                            display: ChartDisplayType.ActionsTable,
                            chartSettings: {
                                xAxis: { column: 'query_start_time' },
                                yAxis: [
                                    {
                                        column: 'query_duration_ms',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                    {
                                        column: 'created_by',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                seriesBreakdownColumn: null,
                            },
                            tableSettings: {
                                columns: requestNameBreakdownEnabled
                                    ? [
                                        {
                                            column: 'finished_at',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'name',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query_duration_ms',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'created_by',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                    ]
                                    : [
                                        {
                                            column: 'finished_at',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query_duration_ms',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'created_by',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                    ],
                                conditionalFormatting: [],
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_last_20_queries',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                    {
                        kind: 'query',
                        tileId: EmbeddedAnalyticsTileId.API_EXPENSIVE_QUERIES,
                        title: '25 most expensive queries',
                        layout: {
                            colSpanClassName: 'md:col-span-full',
                        },
                        query: {
                            kind: NodeKind.DataVisualizationNode,
                            source: {
                                kind: NodeKind.HogQLQuery,
                                query: requestNameBreakdownEnabled
                                    ? `select 
                                            query_start_time, 
                                            name,
                                            query,
                                            query_duration_ms,
                                            read_bytes / 1e12 as read_tb, 
                                            cpu_microseconds / 1e6 as cpu_sec,
                                            created_by
                                        from query_log
                                        where 
                                            is_personal_api_key_request
                                            and event_date >= '${dateFrom}'
                                            and event_date <= '${dateTo}'
                                        order by read_tb desc
                                        limit 25`
                                    : `select 
                                            query_start_time, 
                                            query,
                                            query_duration_ms,
                                            read_bytes / 1e12 as read_tb, 
                                            cpu_microseconds / 1e6 as cpu_sec,
                                            created_by
                                        from query_log
                                        where 
                                            is_personal_api_key_request
                                            and event_date >= '${dateFrom}'
                                            and event_date <= '${dateTo}'
                                        order by read_tb desc
                                        limit 25`,
                            },
                            display: ChartDisplayType.ActionsTable,
                            chartSettings: {
                                xAxis: { column: 'query_start_time' },
                                yAxis: [
                                    {
                                        column: 'read_tb',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                    {
                                        column: 'cpu_sec',
                                        settings: { formatting: { prefix: '', suffix: '' } },
                                    },
                                ],
                                seriesBreakdownColumn: null,
                            },
                            tableSettings: {
                                columns: requestNameBreakdownEnabled
                                    ? [
                                        {
                                            column: 'query_start_time',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'name',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query_duration_ms',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'read_tb',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'cpu_sec',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'created_by',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                    ]
                                    : [
                                        {
                                            column: 'query_start_time',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'query_duration_ms',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'read_tb',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'cpu_sec',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                        {
                                            column: 'created_by',
                                            settings: { formatting: { prefix: '', suffix: '' } },
                                        },
                                    ],
                                conditionalFormatting: [],
                            },
                        },
                        insightProps: {
                            dashboardItemId: 'embedded_analytics_expensive_queries',
                            cachedInsight: null,
                        } as InsightLogicProps,
                        canOpenInsight: false,
                        canOpenModal: false,
                    },
                ]
            }
        ],
    }),
])
